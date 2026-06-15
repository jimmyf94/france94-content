import { NextRequest, NextResponse } from 'next/server';

import { createGeminiClient } from '@fr94/ai/gemini-client.js';
import {
  assembleReelFromClips,
  buildVariantBaseFromCandidate,
  enqueueReelRenderJob,
  type AssembledReel,
} from '@fr94/reel-assembly';

import { loadAutoReelRenderEnabled } from '@fr94/pipeline-settings';
import { collectAttachedClipIds } from '@/lib/append-candidate-reel-clips';
import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function isLockedStatus(status: string | null | undefined): boolean {
  return status === 'ready_to_publish' || status === 'posted';
}

function asPreviousVersionsArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function snapshotFromCandidate(row: Record<string, unknown>, now: string) {
  return {
    reassembled_at: now,
    reviewer_notes: (row.reviewer_notes as string | null) ?? null,
    title: row.title ?? null,
    hook: row.hook ?? null,
    concept_summary: row.concept_summary ?? null,
    caption_fr: row.caption_fr ?? null,
    caption_en: row.caption_en ?? null,
    hashtags: row.hashtags ?? null,
    reel_instructions: row.reel_instructions ?? null,
    reel_reasoning: row.reel_reasoning ?? null,
    selected_clip_ids: row.selected_clip_ids ?? null,
    source_asset_ids: row.source_asset_ids ?? null,
    source_drive_file_ids: row.source_drive_file_ids ?? null,
    llm_raw: row.llm_raw ?? null,
  };
}

function updateFromAssembledReel(reel: AssembledReel, existingSpec: Record<string, unknown> | null) {
  const preservedOverlayEndSec =
    existingSpec && typeof existingSpec.overlay_end_sec !== 'undefined'
      ? existingSpec.overlay_end_sec
      : undefined;
  const preservedTimedCues =
    existingSpec && Array.isArray(existingSpec.timed_overlay_cues)
      ? existingSpec.timed_overlay_cues
      : undefined;
  const preservedTextStyle =
    existingSpec && existingSpec.text_style && typeof existingSpec.text_style === 'object'
      ? existingSpec.text_style
      : reel.spec.text_style;

  return {
    title: reel.title,
    hook: reel.hook,
    concept_summary: reel.concept_summary || null,
    caption_fr: reel.caption_fr,
    caption_en: reel.caption_en,
    hashtags: reel.hashtags,
    selected_series: reel.selected_series,
    title_overlay: reel.spec.overlay_lines[0] ?? reel.hook,
    reel_instructions: {
      ...reel.spec,
      ...(preservedOverlayEndSec !== undefined ? { overlay_end_sec: preservedOverlayEndSec } : {}),
      ...(preservedTimedCues ? { timed_overlay_cues: preservedTimedCues } : {}),
      text_style: preservedTextStyle,
    },
    reel_reasoning: reel.reasoning,
    selected_clip_ids: reel.selected_clip_ids,
    source_asset_ids: reel.source_asset_ids,
    source_drive_file_ids: reel.source_drive_file_ids,
    priority_score: reel.priority_score,
    mission_score: reel.mission_score,
    human_score: reel.human_score,
    sponsor_safety_score: reel.sponsor_safety_score,
    llm_model: reel.llmModel,
    llm_raw: reel.llmRaw,
  };
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
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[reassemble-clips] read', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  const candidate = row as unknown as Record<string, unknown>;
  if (String(candidate.post_type ?? '') !== 'reel') {
    return NextResponse.json({ error: 'Only reel candidates support clip reassembly' }, { status: 400 });
  }
  if (isLockedStatus(candidate.status as string | null)) {
    return NextResponse.json({ error: 'Candidate is locked for publishing' }, { status: 400 });
  }

  const variantBase = buildVariantBaseFromCandidate({
    id: String(candidate.id),
    hook: (candidate.hook as string | null) ?? null,
    selected_series: (candidate.selected_series as string | null) ?? null,
    reel_instructions: candidate.reel_instructions,
  });
  if (!variantBase) {
    return NextResponse.json(
      { error: 'Candidate is not a clip-based reel (missing clips-v1 reel_instructions)' },
      { status: 400 },
    );
  }

  const clipPoolIds = collectAttachedClipIds(candidate.reel_instructions, candidate.selected_clip_ids);
  if (clipPoolIds.length === 0) {
    return NextResponse.json({ error: 'Candidate has no attached clips to reassemble from' }, { status: 400 });
  }

  let assembled;
  try {
    const ai = createGeminiClient(requireEnv('GEMINI_API_KEY'));
    assembled = await assembleReelFromClips({
      supabase,
      ai,
      targetSeriesSlug: variantBase.selected_series ?? undefined,
      clipPoolIds,
      variant: {
        kind: 'different_clip_order',
        base: variantBase,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[reassemble-clips] assemble', msg);
    return NextResponse.json({ error: `Clip reassembly failed: ${msg}` }, { status: 502 });
  }

  if (!assembled.ok) {
    return NextResponse.json({ error: assembled.skipped }, { status: 422 });
  }

  const now = new Date().toISOString();
  const existingSpec =
    candidate.reel_instructions != null &&
    typeof candidate.reel_instructions === 'object' &&
    !Array.isArray(candidate.reel_instructions)
      ? (candidate.reel_instructions as Record<string, unknown>)
      : null;

  const regenerationCount =
    typeof candidate.regeneration_count === 'number' ? candidate.regeneration_count : 0;
  const previousVersions = [
    ...asPreviousVersionsArray(candidate.previous_versions),
    snapshotFromCandidate(candidate, now),
  ];

  const update = {
    ...updateFromAssembledReel(assembled.reel, existingSpec),
    last_regenerated_at: now,
    regeneration_count: regenerationCount + 1,
    previous_versions: previousVersions,
    updated_at: now,
  };

  const { data: updated, error: updErr } = await supabase
    .from('post_candidates')
    .update(update)
    .eq('id', id)
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .maybeSingle();

  if (updErr) {
    console.error('[reassemble-clips] update', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Candidate not found after update' }, { status: 404 });
  }

  const autoReelRenderEnabled = await loadAutoReelRenderEnabled(supabase);
  let renderQueued = false;
  if (autoReelRenderEnabled) {
    const renderRes = await enqueueReelRenderJob(supabase, {
      candidateId: id,
      reel: assembled.reel,
    });
    if (renderRes.error) {
      console.warn('[reassemble-clips] render enqueue', renderRes.error);
    } else {
      renderQueued = true;
    }
  }

  return NextResponse.json({
    candidate: updated,
    render_queued: renderQueued,
  });
}
