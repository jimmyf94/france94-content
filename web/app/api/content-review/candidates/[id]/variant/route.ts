import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createGeminiClient } from '@fr94/ai/gemini-client.js';
import { loadReadyClipsForReels } from '@fr94/content-clips';
import { loadActiveSeries } from '@fr94/content-series';
import {
  assembleReelFromClips,
  buildVariantBaseFromCandidate,
  enqueueReelRenderJob,
  insertReelCandidate,
  pickAlternateSeriesSlug,
  REEL_VARIANT_KINDS,
  type ReelVariantKind,
} from '@fr94/reel-assembly';

import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  kind: z.enum(REEL_VARIANT_KINDS),
});

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid body';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: row, error: readErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[candidate variant] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const candidate = row as unknown as Record<string, unknown>;
  const postType = String(candidate.post_type ?? '');
  if (postType !== 'reel') {
    return NextResponse.json({ error: 'Variants are only supported for reel candidates' }, { status: 400 });
  }

  const variantBase = buildVariantBaseFromCandidate({
    id: String(candidate.id),
    hook: (candidate.hook as string | null) ?? null,
    selected_series: (candidate.selected_series as string | null) ?? null,
    reel_instructions: candidate.reel_instructions,
  });

  if (!variantBase) {
    return NextResponse.json(
      {
        error:
          'Candidate is not a clip-based reel (missing clips-v1 reel_instructions). Run full-video ingestion and generate a clip reel first.',
      },
      { status: 400 },
    );
  }

  const kind = body.kind as ReelVariantKind;
  let targetSeriesSlug: string | undefined;

  if (kind === 'different_series') {
    const [series, clips] = await Promise.all([
      loadActiveSeries(supabase),
      loadReadyClipsForReels(supabase, { limit: 200 }),
    ]);
    targetSeriesSlug = pickAlternateSeriesSlug(series, clips, variantBase.selected_series);
    if (!targetSeriesSlug) {
      return NextResponse.json(
        { error: 'No alternate reel-enabled series available for a different-series variant' },
        { status: 400 },
      );
    }
  }

  let assembled;
  try {
    const ai = createGeminiClient(requireEnv('GEMINI_API_KEY'));
    assembled = await assembleReelFromClips({
      supabase,
      ai,
      targetSeriesSlug,
      variant: { kind, base: variantBase },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidate variant] assemble', msg);
    return NextResponse.json({ error: `Variant assembly failed: ${msg}` }, { status: 502 });
  }

  if (!assembled.ok) {
    return NextResponse.json({ error: assembled.skipped }, { status: 422 });
  }

  const rootId =
    typeof candidate.variant_of === 'string' && candidate.variant_of.trim()
      ? candidate.variant_of.trim()
      : String(candidate.id);

  const ins = await insertReelCandidate(supabase, {
    reel: assembled.reel,
    candidateDate:
      typeof candidate.candidate_date === 'string' && candidate.candidate_date.trim()
        ? candidate.candidate_date.trim()
        : utcDateString(),
    variantOf: rootId,
    variantKind: kind,
  });

  if (ins.error) {
    console.error('[candidate variant] insert', ins.error);
    return NextResponse.json({ error: ins.error }, { status: 500 });
  }

  const renderRes = await enqueueReelRenderJob(supabase, {
    candidateId: ins.id,
    reel: assembled.reel,
  });
  if (renderRes.error) {
    console.warn('[candidate variant] render enqueue', renderRes.error);
  }

  const { data: created, error: fetchErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', ins.id)
    .maybeSingle();

  if (fetchErr) {
    console.error('[candidate variant] fetch created', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  return NextResponse.json({
    candidate: created,
    variant_kind: kind,
    render_queued: !renderRes.error,
  });
}
