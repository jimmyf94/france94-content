import { NextRequest, NextResponse } from 'next/server';

import {
  buildAssetSummary,
  CONTENT_ASSET_COLUMNS_FOR_REWRITE,
  regenerateCandidateWithLLM,
  type ContentAssetRow,
  type RegenerateInputCandidate,
} from '@/lib/post-candidate-rewrite';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const CANDIDATE_COLUMNS_FOR_LOAD = [
  'id',
  'post_type',
  'title',
  'hook',
  'concept_summary',
  'rationale',
  'caption_fr',
  'caption_en',
  'hashtags',
  'story_frames',
  'reel_instructions',
  'carousel_slides',
  'static_post_instructions',
  'priority_score',
  'mission_score',
  'human_score',
  'sponsor_safety_score',
  'effort_score',
  'reviewer_notes',
  'source_asset_ids',
  'source_drive_file_ids',
  'llm_raw',
  'regeneration_count',
  'previous_versions',
].join(', ');

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function asPreviousVersionsArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  const { data: row, error: readErr } = await supabase
    .from('post_candidates')
    .select(CANDIDATE_COLUMNS_FOR_LOAD)
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[candidate regenerate] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const rowAny = row as unknown as Record<string, unknown>;
  const sourceAssetIds = asStringArray(rowAny.source_asset_ids);
  if (sourceAssetIds.length === 0) {
    return NextResponse.json(
      { error: 'Candidate has no attached source assets to regenerate from' },
      { status: 400 },
    );
  }

  const { data: assetRows, error: assetsErr } = await supabase
    .from('content_assets')
    .select(CONTENT_ASSET_COLUMNS_FOR_REWRITE)
    .in('id', sourceAssetIds);

  if (assetsErr) {
    console.error('[candidate regenerate] assets read', assetsErr);
    return NextResponse.json({ error: assetsErr.message }, { status: 500 });
  }

  const assets = (assetRows ?? []) as unknown as ContentAssetRow[];
  if (assets.length === 0) {
    return NextResponse.json(
      { error: 'Attached source assets not found in content_assets' },
      { status: 400 },
    );
  }

  const assetSummaries = assets.map((a) => buildAssetSummary(a));

  const candidateForLLM: RegenerateInputCandidate = {
    id: String(rowAny.id),
    post_type: (rowAny.post_type as string | null) ?? null,
    title: (rowAny.title as string | null) ?? null,
    hook: (rowAny.hook as string | null) ?? null,
    concept_summary: (rowAny.concept_summary as string | null) ?? null,
    rationale: (rowAny.rationale as string | null) ?? null,
    caption_fr: (rowAny.caption_fr as string | null) ?? null,
    caption_en: (rowAny.caption_en as string | null) ?? null,
    hashtags: Array.isArray(rowAny.hashtags) ? (rowAny.hashtags as string[]) : null,
    story_frames: rowAny.story_frames ?? null,
    reel_instructions: rowAny.reel_instructions ?? null,
    carousel_slides: rowAny.carousel_slides ?? null,
    static_post_instructions: rowAny.static_post_instructions ?? null,
    priority_score: (rowAny.priority_score as number | null) ?? null,
    mission_score: (rowAny.mission_score as number | null) ?? null,
    human_score: (rowAny.human_score as number | null) ?? null,
    sponsor_safety_score: (rowAny.sponsor_safety_score as number | null) ?? null,
    effort_score: (rowAny.effort_score as number | null) ?? null,
  };

  const reviewerNotes = ((rowAny.reviewer_notes as string | null) ?? '').trim();

  let llmResult;
  try {
    llmResult = await regenerateCandidateWithLLM({
      candidate: candidateForLLM,
      reviewerNotes,
      assetSummaries,
      validAssetIds: sourceAssetIds,
      supabase,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidate regenerate] LLM', msg);
    return NextResponse.json({ error: `Regenerate failed: ${msg}` }, { status: 502 });
  }

  const now = new Date().toISOString();
  const rewritten = llmResult.rewritten;

  // Snapshot the pre-rewrite content for previous_versions before overwriting.
  const snapshot = {
    regenerated_at: now,
    reviewer_notes: reviewerNotes || null,
    title: candidateForLLM.title,
    hook: candidateForLLM.hook,
    concept_summary: candidateForLLM.concept_summary,
    caption_fr: candidateForLLM.caption_fr,
    caption_en: candidateForLLM.caption_en,
    hashtags: candidateForLLM.hashtags,
    story_frames: candidateForLLM.story_frames,
    reel_instructions: candidateForLLM.reel_instructions,
    carousel_slides: candidateForLLM.carousel_slides,
    static_post_instructions: candidateForLLM.static_post_instructions,
    llm_raw: rowAny.llm_raw ?? null,
  };

  const previousVersions = [...asPreviousVersionsArray(rowAny.previous_versions), snapshot];
  const regenerationCount =
    typeof rowAny.regeneration_count === 'number' ? rowAny.regeneration_count : 0;

  const update: Record<string, unknown> = {
    post_type: rewritten.post_type,
    title: rewritten.title.trim(),
    hook: rewritten.hook?.trim() || null,
    concept_summary: rewritten.concept_summary?.trim() || null,
    rationale: rewritten.rationale?.trim() || null,
    caption_fr: rewritten.caption_fr,
    caption_en: rewritten.caption_en?.trim() ? rewritten.caption_en.trim() : null,
    hashtags: rewritten.hashtags,
    story_frames: Array.isArray(rewritten.story_frames) ? rewritten.story_frames : [],
    reel_instructions:
      rewritten.reel_instructions && typeof rewritten.reel_instructions === 'object'
        ? rewritten.reel_instructions
        : {},
    carousel_slides: Array.isArray(rewritten.carousel_slides) ? rewritten.carousel_slides : [],
    static_post_instructions:
      rewritten.static_post_instructions && typeof rewritten.static_post_instructions === 'object'
        ? rewritten.static_post_instructions
        : {},
    priority_score: rewritten.priority_score,
    mission_score: rewritten.mission_score,
    human_score: rewritten.human_score,
    sponsor_safety_score: rewritten.sponsor_safety_score,
    effort_score: rewritten.effort_score,
    ...(rewritten.selected_series?.trim()
      ? { selected_series: rewritten.selected_series.trim() }
      : {}),
    // Keep current status (e.g. needs_rewrite stays in the rewrite queue);
    // reviewer decides when to move it forward.
    llm_model: llmResult.model,
    llm_raw: llmResult.llmRaw,
    last_regenerated_at: now,
    regeneration_count: regenerationCount + 1,
    previous_versions: previousVersions,
    updated_at: now,
  };

  const { data: updated, error: updErr } = await supabase
    .from('post_candidates')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (updErr) {
    console.error('[candidate regenerate] update', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json({ error: 'Candidate not found after update' }, { status: 404 });
  }

  return NextResponse.json({
    candidate: updated,
    stripped_asset_refs: llmResult.strippedAssetRefs,
  });
}
