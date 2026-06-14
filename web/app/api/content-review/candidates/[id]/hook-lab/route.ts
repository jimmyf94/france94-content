import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createGeminiClient } from '@fr94/ai/gemini-client.js';
import {
  applyHookToClipReelCandidate,
  clampHookLabOptionCount,
  createHookVariantsFromClipReelCandidate,
  generateReelHookLabOptions,
  type ClipReelCandidateContext,
} from '@fr94/reel-hook-lab';

import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    option_count: z.number().int().min(20).max(30).optional(),
  }),
  z.object({
    action: z.literal('apply'),
    hook: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal('create_variants'),
    hooks: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  }),
]);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function toClipReelCandidateContext(row: Record<string, unknown>): ClipReelCandidateContext {
  return {
    id: String(row.id),
    candidate_date: (row.candidate_date as string | null) ?? null,
    hook: (row.hook as string | null) ?? null,
    concept_summary: (row.concept_summary as string | null) ?? null,
    caption_fr: (row.caption_fr as string | null) ?? null,
    selected_series: (row.selected_series as string | null) ?? null,
    reel_instructions: row.reel_instructions,
    reel_reasoning: row.reel_reasoning,
    title: (row.title as string | null) ?? null,
    caption_en: (row.caption_en as string | null) ?? null,
    hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : null,
    source_asset_ids: Array.isArray(row.source_asset_ids)
      ? (row.source_asset_ids as string[])
      : null,
    source_drive_file_ids: Array.isArray(row.source_drive_file_ids)
      ? (row.source_drive_file_ids as string[])
      : null,
    priority_score:
      typeof row.priority_score === 'number' ? row.priority_score : null,
    mission_score: typeof row.mission_score === 'number' ? row.mission_score : null,
    human_score: typeof row.human_score === 'number' ? row.human_score : null,
    sponsor_safety_score:
      typeof row.sponsor_safety_score === 'number' ? row.sponsor_safety_score : null,
    variant_of: (row.variant_of as string | null) ?? null,
  };
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
    console.error('[hook-lab] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const candidateRow = row as unknown as Record<string, unknown>;
  const postType = String(candidateRow.post_type ?? '');
  if (postType !== 'reel') {
    return NextResponse.json({ error: 'Hook lab is only supported for reel candidates' }, { status: 400 });
  }

  const candidate = toClipReelCandidateContext(candidateRow);

  if (body.action === 'generate') {
    let result;
    try {
      const ai = createGeminiClient(requireEnv('GEMINI_API_KEY'));
      result = await generateReelHookLabOptions({
        supabase,
        ai,
        candidate,
        optionCount: clampHookLabOptionCount(body.option_count),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[hook-lab] generate', msg);
      return NextResponse.json({ error: `Hook lab generation failed: ${msg}` }, { status: 502 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      options: result.options,
      option_count: result.options.length,
      llm_model: result.llmModel,
    });
  }

  if (body.action === 'apply') {
    const applied = await applyHookToClipReelCandidate(supabase, candidate, body.hook);
    if (!applied.ok) {
      return NextResponse.json({ error: applied.error }, { status: 400 });
    }

    const { data: updated, error: fetchErr } = await supabase
      .from('post_candidates')
      .select(POST_CANDIDATE_DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[hook-lab] fetch after apply', fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    return NextResponse.json({ candidate: updated, hook: body.hook.trim() });
  }

  const variantResult = await createHookVariantsFromClipReelCandidate(
    supabase,
    candidate,
    body.hooks,
  );

  if (variantResult.created.length === 0) {
    return NextResponse.json(
      { error: variantResult.errors[0] ?? 'No variants created' },
      { status: 400 },
    );
  }

  const createdIds = variantResult.created.map((c) => c.candidate_id);
  const { data: createdRows, error: createdErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .in('id', createdIds);

  if (createdErr) {
    console.error('[hook-lab] fetch created', createdErr);
    return NextResponse.json({ error: createdErr.message }, { status: 500 });
  }

  const byId = new Map(
    (createdRows ?? []).map((r) => [String((r as { id?: string }).id), r]),
  );

  return NextResponse.json({
    created: variantResult.created.map((item) => ({
      ...item,
      candidate: byId.get(item.candidate_id) ?? null,
    })),
    errors: variantResult.errors,
  });
}
