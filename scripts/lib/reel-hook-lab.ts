import { createPartFromText, type GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  callGeminiWithLogging,
  getResolvedModelRoute,
  responseToJson,
} from './ai/gemini-client.js';
import { parseGeminiJsonObject } from './ai/parse-gemini-json.js';
import { loadComposedStableSystemInstruction } from './ai/resolve-stable-prompt.js';
import { cacheKeyCandidateGeneration, getFr94PromptVersion } from './ai/prompt-version.js';
import { loadRecentLedgerContext, toCommittedPostForPrompt } from './content-ledger.js';
import { appendSeriesToSystemInstruction, loadActiveSeries, type SeriesRow } from './content-series.js';
import type { ClipWithAsset } from './content-clips.js';
import {
  buildVariantBaseFromCandidate,
  enqueueReelRenderJob,
  insertReelCandidate,
  parseReelSpecification,
  type AssembledReel,
  type ReelReasoning,
  type ReelSpecification,
} from './reel-assembly.js';
import { resolveFr94Phase, type Fr94ProjectPhase } from './ai/prompts/post-planner.js';
import { mergeHookWithOverlayLines } from './reel-text-style.js';

export const DEFAULT_HOOK_LAB_OPTION_COUNT = 9;
export const MIN_HOOK_LAB_OPTION_COUNT = 6;
export const MAX_HOOK_LAB_OPTION_COUNT = 9;

export type ReelHookLabOptionStatus =
  | 'pending'
  | 'accepted'
  | 'deleted'
  | 'applied'
  | 'variant_created';

export type ReelHookLabOption = {
  hook: string;
  angle: string;
  why_it_could_work: string;
  discovery_fit: string;
  risk?: string;
};

export type ReelHookLabPersistedOption = ReelHookLabOption & {
  id: string;
  batch_id: string;
  status: ReelHookLabOptionStatus;
  seq: number;
  created_at: string;
};

export type ReelHookLabBatchRow = {
  id: string;
  post_candidate_id: string;
  status: string;
  reviewer_notes: string | null;
  option_count: number;
  llm_model: string | null;
  created_at: string;
};

export type ReelHookLabState = {
  active_batch: ReelHookLabBatchRow | null;
  pending: ReelHookLabPersistedOption[];
  accepted: ReelHookLabPersistedOption[];
};

export type ReelHookLabGenerateResult =
  | {
      ok: true;
      options: ReelHookLabPersistedOption[];
      batch: ReelHookLabBatchRow;
      llmModel: string;
    }
  | { ok: false; error: string };

export type ClipReelCandidateContext = {
  id: string;
  candidate_date: string | null;
  hook: string | null;
  concept_summary: string | null;
  caption_fr: string | null;
  selected_series: string | null;
  reel_instructions: unknown;
  reel_reasoning: unknown;
  title: string | null;
  caption_en: string | null;
  hashtags: string[] | null;
  source_asset_ids: string[] | null;
  source_drive_file_ids: string[] | null;
  priority_score: number | null;
  mission_score: number | null;
  human_score: number | null;
  sponsor_safety_score: number | null;
  variant_of?: string | null;
};

function optionalTextField(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

const hookLabOptionSchema = z.object({
  hook: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()),
    z.string().min(1),
  ),
  angle: z.preprocess(optionalTextField, z.string().optional().default('')),
  why_it_could_work: z.preprocess(optionalTextField, z.string().optional().default('')),
  discovery_fit: z.preprocess(optionalTextField, z.string().optional().default('')),
  risk: z.preprocess(optionalTextField, z.string().optional()),
});

const hookLabResponseSchema = z.object({
  options: z.array(hookLabOptionSchema).min(1),
});

function seriesForPrompt(s: SeriesRow) {
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    vision: s.vision,
    tone: s.tone,
    discovery_patterns: s.discovery_patterns,
    examples: s.examples,
    body_md: s.body_md,
  };
}

function clipMetaForPrompt(c: ClipWithAsset) {
  return {
    clip_id: c.id,
    asset_id: c.content_asset_id,
    start_sec: Number(c.start_sec),
    end_sec: Number(c.end_sec),
    duration_sec: Number(c.end_sec) - Number(c.start_sec),
    visual_summary: c.visual_summary,
    transcript_excerpt: c.transcript_excerpt,
    pov_concepts: c.pov_concepts,
    hooks: c.hooks,
    emotional_tags: c.emotional_tags,
    tension_tags: c.tension_tags,
    visual_tags: c.visual_tags,
    discovery_tags: c.discovery_tags,
    could_be_used_for: c.could_be_used_for,
  };
}

function parseReasoning(raw: unknown): ReelReasoning | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as ReelReasoning;
}

function normalizeHookLabOptions(raw: z.infer<typeof hookLabOptionSchema>[]): ReelHookLabOption[] {
  const seen = new Set<string>();
  const out: ReelHookLabOption[] = [];
  for (const row of raw) {
    const hook = row.hook.trim();
    if (!hook) continue;
    const key = hook.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      hook,
      angle: row.angle.trim(),
      why_it_could_work: row.why_it_could_work.trim(),
      discovery_fit: row.discovery_fit.trim(),
      risk: row.risk?.trim() || undefined,
    });
  }
  return out;
}

export function clampHookLabOptionCount(count: number | undefined): number {
  const n = count ?? DEFAULT_HOOK_LAB_OPTION_COUNT;
  if (!Number.isFinite(n)) return DEFAULT_HOOK_LAB_OPTION_COUNT;
  return Math.min(MAX_HOOK_LAB_OPTION_COUNT, Math.max(1, Math.round(n)));
}

function rowToPersistedOption(row: Record<string, unknown>): ReelHookLabPersistedOption {
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    status: String(row.status) as ReelHookLabOptionStatus,
    seq: typeof row.seq === 'number' ? row.seq : Number(row.seq ?? 0),
    hook: String(row.hook ?? ''),
    angle: String(row.angle ?? ''),
    why_it_could_work: String(row.why_it_could_work ?? ''),
    discovery_fit: String(row.discovery_fit ?? ''),
    risk: typeof row.risk === 'string' && row.risk.trim() ? row.risk.trim() : undefined,
    created_at: String(row.created_at ?? ''),
  };
}

function rowToBatch(row: Record<string, unknown>): ReelHookLabBatchRow {
  return {
    id: String(row.id),
    post_candidate_id: String(row.post_candidate_id),
    status: String(row.status ?? 'active'),
    reviewer_notes:
      typeof row.reviewer_notes === 'string' && row.reviewer_notes.trim()
        ? row.reviewer_notes.trim()
        : null,
    option_count: typeof row.option_count === 'number' ? row.option_count : DEFAULT_HOOK_LAB_OPTION_COUNT,
    llm_model: typeof row.llm_model === 'string' ? row.llm_model : null,
    created_at: String(row.created_at ?? ''),
  };
}

export async function loadReelHookLabState(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<ReelHookLabState> {
  const { data: batchRows, error: batchErr } = await supabase
    .from('reel_hook_lab_batches')
    .select('id, post_candidate_id, status, reviewer_notes, option_count, llm_model, created_at')
    .eq('post_candidate_id', candidateId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  if (batchErr) throw new Error(`loadReelHookLabState batches: ${batchErr.message}`);

  const activeBatch = batchRows?.[0] ? rowToBatch(batchRows[0] as Record<string, unknown>) : null;

  const { data: acceptedRows, error: acceptedErr } = await supabase
    .from('reel_hook_lab_options')
    .select(
      'id, batch_id, status, seq, hook, angle, why_it_could_work, discovery_fit, risk, created_at',
    )
    .eq('post_candidate_id', candidateId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });

  if (acceptedErr) throw new Error(`loadReelHookLabState accepted: ${acceptedErr.message}`);

  let pending: ReelHookLabPersistedOption[] = [];
  if (activeBatch) {
    const { data: pendingRows, error: pendingErr } = await supabase
      .from('reel_hook_lab_options')
      .select(
        'id, batch_id, status, seq, hook, angle, why_it_could_work, discovery_fit, risk, created_at',
      )
      .eq('batch_id', activeBatch.id)
      .eq('status', 'pending')
      .order('seq', { ascending: true });

    if (pendingErr) throw new Error(`loadReelHookLabState pending: ${pendingErr.message}`);
    pending = (pendingRows ?? []).map((r) => rowToPersistedOption(r as Record<string, unknown>));
  }

  return {
    active_batch: activeBatch,
    pending,
    accepted: (acceptedRows ?? []).map((r) => rowToPersistedOption(r as Record<string, unknown>)),
  };
}

type PriorHookLabContext = {
  accepted_hooks: string[];
  deleted_hooks: string[];
  prior_pending_hooks: string[];
};

async function loadPriorHookLabContext(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<PriorHookLabContext> {
  const { data, error } = await supabase
    .from('reel_hook_lab_options')
    .select('hook, status')
    .eq('post_candidate_id', candidateId)
    .in('status', ['accepted', 'deleted', 'pending', 'applied', 'variant_created']);

  if (error) throw new Error(`loadPriorHookLabContext: ${error.message}`);

  const accepted_hooks: string[] = [];
  const deleted_hooks: string[] = [];
  const prior_pending_hooks: string[] = [];

  for (const row of data ?? []) {
    const hook = typeof row.hook === 'string' ? row.hook.trim() : '';
    if (!hook) continue;
    const status = String(row.status ?? '');
    if (status === 'accepted') accepted_hooks.push(hook);
    else if (status === 'deleted') deleted_hooks.push(hook);
    else if (status === 'pending') prior_pending_hooks.push(hook);
  }

  return { accepted_hooks, deleted_hooks, prior_pending_hooks };
}

async function supersedeActiveHookLabBatches(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('reel_hook_lab_batches')
    .update({ status: 'superseded', updated_at: now })
    .eq('post_candidate_id', candidateId)
    .eq('status', 'active');

  if (error) throw new Error(`supersedeActiveHookLabBatches: ${error.message}`);
}

async function persistHookLabBatch(params: {
  supabase: SupabaseClient;
  candidateId: string;
  reviewerNotes: string | null;
  optionCount: number;
  llmModel: string;
  llmRaw: unknown;
  options: ReelHookLabOption[];
}): Promise<{ batch: ReelHookLabBatchRow; options: ReelHookLabPersistedOption[] }> {
  await supersedeActiveHookLabBatches(params.supabase, params.candidateId);
  const now = new Date().toISOString();

  const { data: batchRow, error: batchErr } = await params.supabase
    .from('reel_hook_lab_batches')
    .insert({
      post_candidate_id: params.candidateId,
      status: 'active',
      reviewer_notes: params.reviewerNotes,
      option_count: params.optionCount,
      llm_model: params.llmModel,
      llm_raw: params.llmRaw,
      created_at: now,
      updated_at: now,
    })
    .select('id, post_candidate_id, status, reviewer_notes, option_count, llm_model, created_at')
    .single();

  if (batchErr || !batchRow) {
    throw new Error(`persistHookLabBatch insert batch: ${batchErr?.message ?? 'no row'}`);
  }

  const batch = rowToBatch(batchRow as Record<string, unknown>);
  const optionRows = params.options.map((opt, idx) => ({
    batch_id: batch.id,
    post_candidate_id: params.candidateId,
    seq: idx,
    hook: opt.hook,
    angle: opt.angle,
    why_it_could_work: opt.why_it_could_work,
    discovery_fit: opt.discovery_fit,
    risk: opt.risk ?? null,
    status: 'pending',
    created_at: now,
    updated_at: now,
  }));

  const { data: insertedOptions, error: optErr } = await params.supabase
    .from('reel_hook_lab_options')
    .insert(optionRows)
    .select(
      'id, batch_id, status, seq, hook, angle, why_it_could_work, discovery_fit, risk, created_at',
    );

  if (optErr) throw new Error(`persistHookLabBatch insert options: ${optErr.message}`);

  return {
    batch,
    options: (insertedOptions ?? []).map((r) => rowToPersistedOption(r as Record<string, unknown>)),
  };
}

export async function setReelHookLabOptionStatus(
  supabase: SupabaseClient,
  params: {
    candidateId: string;
    optionId: string;
    status: ReelHookLabOptionStatus;
  },
): Promise<{ ok: true; option: ReelHookLabPersistedOption } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('reel_hook_lab_options')
    .update({ status: params.status, updated_at: now })
    .eq('id', params.optionId)
    .eq('post_candidate_id', params.candidateId)
    .select(
      'id, batch_id, status, seq, hook, angle, why_it_could_work, discovery_fit, risk, created_at',
    )
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Hook lab option not found' };
  return { ok: true, option: rowToPersistedOption(data as Record<string, unknown>) };
}

async function markHookLabOptionsByHookText(
  supabase: SupabaseClient,
  candidateId: string,
  hooks: string[],
  status: ReelHookLabOptionStatus,
): Promise<void> {
  const normalized = [...new Set(hooks.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (normalized.length === 0) return;

  const { data, error } = await supabase
    .from('reel_hook_lab_options')
    .select('id, hook')
    .eq('post_candidate_id', candidateId)
    .in('status', ['pending', 'accepted']);

  if (error || !data) return;

  const ids = data
    .filter((row) => {
      const hook = typeof row.hook === 'string' ? row.hook.trim().toLowerCase() : '';
      return hook && normalized.includes(hook);
    })
    .map((row) => String(row.id));

  if (ids.length === 0) return;

  const now = new Date().toISOString();
  await supabase
    .from('reel_hook_lab_options')
    .update({ status, updated_at: now })
    .in('id', ids);
}

/** Load clip rows (with asset join) for the clip ids used in a reel spec. */
export async function loadClipsByIds(
  supabase: SupabaseClient,
  clipIds: string[],
): Promise<ClipWithAsset[]> {
  const ids = [...new Set(clipIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('content_clips')
    .select(
      `*, asset:content_assets!inner (
        id, drive_file_id, current_filename, final_filename,
        duration_seconds, usage_status, quality_score, processed_at,
        status, candidate_eligibility
      )`,
    )
    .in('id', ids);

  if (error) throw new Error(`loadClipsByIds: ${error.message}`);
  return (data ?? []) as unknown as ClipWithAsset[];
}

export function requireClipReelCandidateContext(
  candidate: ClipReelCandidateContext,
): { spec: ReelSpecification; variantBase: NonNullable<ReturnType<typeof buildVariantBaseFromCandidate>> } | null {
  const spec = parseReelSpecification(candidate.reel_instructions);
  if (!spec) return null;
  const variantBase = buildVariantBaseFromCandidate({
    id: candidate.id,
    hook: candidate.hook,
    selected_series: candidate.selected_series,
    reel_instructions: candidate.reel_instructions,
  });
  if (!variantBase) return null;
  return { spec, variantBase };
}

function buildAssembledReelWithHook(
  candidate: ClipReelCandidateContext,
  spec: ReelSpecification,
  hook: string,
): AssembledReel {
  const hookTrim = hook.trim();
  const overlayLines = mergeHookWithOverlayLines(spec.overlay_lines, hookTrim).slice(0, 2);
  const nextSpec: ReelSpecification = {
    ...spec,
    overlay_lines: overlayLines,
  };
  const reasoning = parseReasoning(candidate.reel_reasoning);
  const sourceAssetIds = Array.isArray(candidate.source_asset_ids)
    ? candidate.source_asset_ids.filter((id): id is string => typeof id === 'string')
    : [...new Set(spec.clips.map((c) => c.asset_id))];
  const sourceDriveFileIds = Array.isArray(candidate.source_drive_file_ids)
    ? candidate.source_drive_file_ids.filter((id): id is string => typeof id === 'string')
    : [...new Set(spec.clips.map((c) => c.drive_file_id))];

  return {
    title: candidate.title?.trim() || hookTrim.slice(0, 80),
    hook: hookTrim,
    concept_summary: candidate.concept_summary?.trim() || '',
    caption_fr: candidate.caption_fr?.trim() || '',
    caption_en: candidate.caption_en?.trim() || null,
    hashtags: Array.isArray(candidate.hashtags) ? candidate.hashtags : [],
    selected_series: candidate.selected_series?.trim() || '',
    spec: nextSpec,
    reasoning: {
      why_script_works: reasoning?.why_script_works ?? '',
      why_clips_support_script: reasoning?.why_clips_support_script ?? '',
      emotional_contrast: reasoning?.emotional_contrast ?? '',
      scroll_stop: reasoning?.scroll_stop ?? '',
      series_fit: reasoning?.series_fit ?? '',
      clips_vs_alternatives: reasoning?.clips_vs_alternatives ?? '',
    },
    selected_clip_ids: spec.clips.map((c) => c.clip_id),
    source_asset_ids: sourceAssetIds,
    source_drive_file_ids: sourceDriveFileIds,
    priority_score: candidate.priority_score ?? 5,
    mission_score: candidate.mission_score ?? 5,
    human_score: candidate.human_score ?? 5,
    sponsor_safety_score: candidate.sponsor_safety_score ?? 5,
    llmModel: 'manual_hook_lab',
    llmRaw: { source: 'reel_hook_lab' },
  };
}

export async function generateReelHookLabOptions(params: {
  supabase: SupabaseClient;
  ai: GoogleGenAI;
  candidate: ClipReelCandidateContext;
  optionCount?: number;
  reviewerNotes?: string | null;
  currentPhase?: Fr94ProjectPhase;
}): Promise<ReelHookLabGenerateResult> {
  const ctx = requireClipReelCandidateContext(params.candidate);
  if (!ctx) {
    return {
      ok: false,
      error:
        'Candidate is not a clip-based reel (missing clips-v1 reel_instructions). Run full-video ingestion first.',
    };
  }

  const { spec, variantBase } = ctx;
  const optionCount = clampHookLabOptionCount(params.optionCount);
  const reviewerNotes = params.reviewerNotes?.trim() || null;
  const clipIds = spec.clips.map((c) => c.clip_id);
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentPhase = params.currentPhase ?? resolveFr94Phase(now);

  const [allSeries, selectedClips, recentLedger, priorHookLab] = await Promise.all([
    loadActiveSeries(params.supabase),
    loadClipsByIds(params.supabase, clipIds),
    loadRecentLedgerContext(params.supabase, { days: 60, limit: 80 }),
    loadPriorHookLabContext(params.supabase, params.candidate.id),
  ]);

  const seriesSlug = params.candidate.selected_series?.trim() || '';
  const targetSeries =
    allSeries.find((s) => s.slug === seriesSlug) ??
    allSeries.find((s) => s.status === 'active') ??
    null;

  if (!targetSeries) {
    return { ok: false, error: 'No active content series found for hook lab context' };
  }

  const reelRecent = recentLedger
    .filter((r) => r.post_type === 'reel')
    .map(toCommittedPostForPrompt);

  const route = await getResolvedModelRoute(params.supabase, 'candidate_generation');
  const composed = await loadComposedStableSystemInstruction(params.supabase, 'task_reel_hook_lab');
  const stable = appendSeriesToSystemInstruction(composed.text, [targetSeries]);

  const payload: Record<string, unknown> = {
    current_date: currentDate,
    current_phase: currentPhase,
    reviewer_notes: reviewerNotes,
    target_series: seriesForPrompt(targetSeries),
    base_candidate: {
      candidate_id: params.candidate.id,
      hook: params.candidate.hook,
      concept_summary: params.candidate.concept_summary,
      caption_fr: params.candidate.caption_fr,
      selected_series: params.candidate.selected_series,
      reel_reasoning: params.candidate.reel_reasoning,
      clips: variantBase.clips,
      overlay_lines: variantBase.overlay_lines,
    },
    selected_clips: selectedClips.map(clipMetaForPrompt),
    constraints: {
      option_count: optionCount,
      hook_max_chars: 60,
      default_format: 'pov',
      language: 'fr',
      keep_clips_fixed: true,
      assume_cold_audience: currentPhase === 'foundation_public_build',
    },
    prior_hook_lab: priorHookLab,
    recent_committed: reelRecent,
  };

  const dynamic = `Dynamic payload (JSON):\n${JSON.stringify(payload, null, 2)}`;
  const promptVersion = getFr94PromptVersion();

  const { response, modelUsed } = await callGeminiWithLogging({
    ai: params.ai,
    supabase: params.supabase,
    route,
    subOperation: 'reel_hook_lab',
    promptVersion,
    cacheKey: cacheKeyCandidateGeneration(promptVersion, stable),
    stableSystemInstruction: stable,
    entity: {
      prompt_keys: ['task_reel_hook_lab'],
      pipeline_step: 'reel_hook_lab',
      post_candidate_id: params.candidate.id,
    },
    getContentsImplicit: () => [createPartFromText(`${stable}\n\n${dynamic}`)],
    getContentsExplicit: () => [createPartFromText(dynamic)],
  });

  const text = response.text?.trim();
  if (!text) return { ok: false, error: 'LLM returned empty text' };

  const json = parseGeminiJsonObject(text);
  const parsed = hookLabResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `invalid hook lab schema: ${parsed.error.message.slice(0, 300)}` };
  }

  const options = normalizeHookLabOptions(parsed.data.options);
  if (options.length < MIN_HOOK_LAB_OPTION_COUNT) {
    return {
      ok: false,
      error: `LLM returned only ${options.length} unique hooks (need at least ${MIN_HOOK_LAB_OPTION_COUNT})`,
    };
  }

  const trimmedOptions = options.slice(0, optionCount);
  let persisted;
  try {
    persisted = await persistHookLabBatch({
      supabase: params.supabase,
      candidateId: params.candidate.id,
      reviewerNotes,
      optionCount,
      llmModel: modelUsed,
      llmRaw: json,
      options: trimmedOptions,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  return {
    ok: true,
    options: persisted.options,
    batch: persisted.batch,
    llmModel: modelUsed,
  };
}

export async function applyHookToClipReelCandidate(
  supabase: SupabaseClient,
  candidate: ClipReelCandidateContext,
  hook: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hookTrim = hook.trim();
  if (!hookTrim) return { ok: false, error: 'Hook is required' };

  const ctx = requireClipReelCandidateContext(candidate);
  if (!ctx) {
    return {
      ok: false,
      error: 'Candidate is not a clip-based reel (missing clips-v1 reel_instructions).',
    };
  }

  const { spec } = ctx;
  const overlayLines = mergeHookWithOverlayLines(spec.overlay_lines, hookTrim).slice(0, 3);
  const mergedReel = {
    ...spec,
    overlay_lines: overlayLines,
  };
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('post_candidates')
    .update({
      hook: hookTrim,
      title_overlay: overlayLines[0] ?? hookTrim,
      reel_instructions: mergedReel,
      updated_at: now,
    })
    .eq('id', candidate.id);

  if (error) return { ok: false, error: error.message };
  await markHookLabOptionsByHookText(supabase, candidate.id, [hookTrim], 'applied');
  return { ok: true };
}

export type HookVariantCreateResult = {
  hook: string;
  candidate_id: string;
  render_queued: boolean;
  error?: string;
};

export async function createHookVariantsFromClipReelCandidate(
  supabase: SupabaseClient,
  candidate: ClipReelCandidateContext,
  hooks: string[],
): Promise<{ created: HookVariantCreateResult[]; errors: string[] }> {
  const ctx = requireClipReelCandidateContext(candidate);
  if (!ctx) {
    return {
      created: [],
      errors: [
        'Candidate is not a clip-based reel (missing clips-v1 reel_instructions).',
      ],
    };
  }

  const uniqueHooks: string[] = [];
  const seen = new Set<string>();
  for (const h of hooks) {
    const trimmed = h.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueHooks.push(trimmed);
  }

  if (uniqueHooks.length === 0) {
    return { created: [], errors: ['No valid hooks provided'] };
  }

  const rootId =
    typeof candidate.variant_of === 'string' && candidate.variant_of.trim()
      ? candidate.variant_of.trim()
      : candidate.id;
  const candidateDate =
    typeof candidate.candidate_date === 'string' && candidate.candidate_date.trim()
      ? candidate.candidate_date.trim()
      : new Date().toISOString().slice(0, 10);

  const created: HookVariantCreateResult[] = [];
  const errors: string[] = [];

  for (const hook of uniqueHooks) {
    const reel = buildAssembledReelWithHook(candidate, ctx.spec, hook);
    const ins = await insertReelCandidate(supabase, {
      reel,
      candidateDate,
      variantOf: rootId,
      variantKind: 'different_hook',
    });

    if (ins.error) {
      errors.push(`${hook}: ${ins.error}`);
      created.push({ hook, candidate_id: ins.id, render_queued: false, error: ins.error });
      continue;
    }

    const renderRes = await enqueueReelRenderJob(supabase, {
      candidateId: ins.id,
      reel,
    });
    if (renderRes.error) {
      errors.push(`${hook}: render enqueue failed — ${renderRes.error}`);
    }

    created.push({
      hook,
      candidate_id: ins.id,
      render_queued: !renderRes.error,
      error: renderRes.error ?? undefined,
    });
  }

  await markHookLabOptionsByHookText(supabase, candidate.id, uniqueHooks, 'variant_created');

  return { created, errors };
}
