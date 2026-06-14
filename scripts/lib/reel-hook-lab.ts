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
import { mergeHookWithOverlayLines } from './reel-text-style.js';

export const DEFAULT_HOOK_LAB_OPTION_COUNT = 30;
export const MIN_HOOK_LAB_OPTION_COUNT = 20;
export const MAX_HOOK_LAB_OPTION_COUNT = 30;

export type ReelHookLabOption = {
  hook: string;
  angle: string;
  why_it_could_work: string;
  discovery_fit: string;
  risk?: string;
};

export type ReelHookLabGenerateResult =
  | { ok: true; options: ReelHookLabOption[]; llmModel: string }
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
  return Math.min(MAX_HOOK_LAB_OPTION_COUNT, Math.max(MIN_HOOK_LAB_OPTION_COUNT, Math.round(n)));
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
  const clipIds = spec.clips.map((c) => c.clip_id);

  const [allSeries, selectedClips, recentLedger] = await Promise.all([
    loadActiveSeries(params.supabase),
    loadClipsByIds(params.supabase, clipIds),
    loadRecentLedgerContext(params.supabase, { days: 60, limit: 80 }),
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
    },
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

  return {
    ok: true,
    options: options.slice(0, optionCount),
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

  return { created, errors };
}
