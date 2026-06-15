import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { loadClipsByIds } from '@fr94/content-clips';
import { REEL_MAX_CLIPS } from '@fr94/reel-clip-limits';

import { appendReelClips } from '@/lib/append-candidate-reel-clips';
import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clip_ids: z.array(z.string().uuid()).min(1).max(REEL_MAX_CLIPS),
});

function dedupeClipIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function isLockedStatus(status: string | null | undefined): boolean {
  return status === 'ready_to_publish' || status === 'posted';
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id: candidateId } = await ctx.params;
  if (!candidateId?.trim()) {
    return NextResponse.json({ error: 'Missing candidate id' }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid request body';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const clipIds = dedupeClipIds(body.clip_ids);
  if (clipIds.length === 0) {
    return NextResponse.json({ error: 'No clip ids provided' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: row, error: readErr } = await supabase
    .from('post_candidates')
    .select(
      'id, post_type, status, reel_instructions, selected_clip_ids, source_asset_ids, source_drive_file_ids',
    )
    .eq('id', candidateId)
    .maybeSingle();

  if (readErr) {
    console.error('[review-clips post] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  if ((row as { post_type?: string | null }).post_type !== 'reel') {
    return NextResponse.json({ error: 'Only reel candidates support adding review clips' }, { status: 400 });
  }

  if (isLockedStatus((row as { status?: string | null }).status)) {
    return NextResponse.json({ error: 'Candidate is locked for publishing' }, { status: 400 });
  }

  const reelInstructions = (row as { reel_instructions?: unknown }).reel_instructions;
  const version =
    reelInstructions != null &&
    typeof reelInstructions === 'object' &&
    !Array.isArray(reelInstructions)
      ? (reelInstructions as Record<string, unknown>).version
      : null;
  if (version !== 'clips-v1') {
    return NextResponse.json(
      { error: 'Candidate is not a clip-based reel (missing clips-v1 reel_instructions)' },
      { status: 400 },
    );
  }

  const clipRows = await loadClipsByIds(supabase, clipIds);
  const byId = new Map(clipRows.map((c) => [c.id.toLowerCase(), c]));
  const newClips = [];

  for (const clipId of clipIds) {
    const clip = byId.get(clipId.toLowerCase());
    if (!clip) {
      return NextResponse.json({ error: `Clip not found: ${clipId}` }, { status: 404 });
    }
    if (clip.status !== 'ready') {
      return NextResponse.json({ error: `Clip ${clipId} is not ready` }, { status: 400 });
    }
    if (clip.asset?.status !== 'processed') {
      return NextResponse.json({ error: `Clip ${clipId} asset is not processed` }, { status: 400 });
    }
    if (clip.asset?.candidate_eligibility === 'excluded') {
      return NextResponse.json({ error: `Clip ${clipId} asset is excluded` }, { status: 400 });
    }
    newClips.push(clip);
  }

  const appendResult = appendReelClips({
    reel_instructions: reelInstructions,
    source_asset_ids: (row as { source_asset_ids?: unknown }).source_asset_ids,
    source_drive_file_ids: (row as { source_drive_file_ids?: unknown }).source_drive_file_ids,
    newClips,
    maxClips: REEL_MAX_CLIPS,
  });

  if ('error' in appendResult) {
    return NextResponse.json({ error: appendResult.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await supabase
    .from('post_candidates')
    .update({
      reel_instructions: appendResult.reel_instructions,
      selected_clip_ids: appendResult.selected_clip_ids,
      source_asset_ids: appendResult.source_asset_ids,
      source_drive_file_ids: appendResult.source_drive_file_ids,
      updated_at: now,
    })
    .eq('id', candidateId)
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .maybeSingle();

  if (updErr) {
    console.error('[review-clips post] candidate update', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json({ error: 'Candidate not found after update' }, { status: 404 });
  }

  return NextResponse.json({ candidate: updated });
}
