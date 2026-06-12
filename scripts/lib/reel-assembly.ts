import { randomUUID } from 'node:crypto';

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
import { loadReadyClipsForReels, type ClipWithAsset } from './content-clips.js';
import {
  appendSeriesToSystemInstruction,
  loadActiveSeries,
  seriesAllowsPostType,
  type SeriesRow,
} from './content-series.js';
import { loadReelRenderDefaults } from './reel-render-defaults.js';
import {
  DEFAULT_REEL_RENDER_TEXT_STYLE,
  parsePartialReelTextStyle,
  resolveReelTextStyle,
  type ReelRenderTextStyle,
} from './reel-text-style.js';

export const REEL_MIN_TOTAL_SEC = 8;
export const REEL_MAX_TOTAL_SEC = 20;
export const REEL_MAX_CLIPS = 3;

export const REEL_VARIANT_KINDS = [
  'different_pov',
  'different_clip_order',
  'different_hook',
  'different_series',
] as const;

export type ReelVariantKind = (typeof REEL_VARIANT_KINDS)[number];

export type ReelSpecClip = {
  clip_id: string;
  asset_id: string;
  drive_file_id: string;
  start_sec: number;
  end_sec: number;
  why?: string;
};

export type { ReelRenderTextStyle as ReelTextStyle } from './reel-text-style.js';
export { DEFAULT_REEL_RENDER_TEXT_STYLE as REEL_TEXT_STYLE } from './reel-text-style.js';

export type ReelSpecification = {
  version: 'clips-v1';
  clips: ReelSpecClip[];
  overlay_lines: string[];
  keep_audio: true;
  text_style: ReelRenderTextStyle;
  total_duration_sec: number;
};

export type ReelReasoning = {
  why_script_works: string;
  why_clips_support_script: string;
  emotional_contrast: string;
  scroll_stop: string;
  series_fit: string;
  clips_vs_alternatives: string;
};

export type AssembledReel = {
  title: string;
  hook: string;
  concept_summary: string;
  caption_fr: string;
  caption_en: string | null;
  hashtags: string[];
  selected_series: string;
  spec: ReelSpecification;
  reasoning: ReelReasoning;
  selected_clip_ids: string[];
  source_asset_ids: string[];
  source_drive_file_ids: string[];
  priority_score: number;
  mission_score: number;
  human_score: number;
  sponsor_safety_score: number;
  llmModel: string;
  llmRaw: Record<string, unknown>;
};

export type ReelVariantRequest = {
  kind: ReelVariantKind;
  base: {
    candidate_id: string;
    hook: string | null;
    selected_series: string | null;
    overlay_lines: string[];
    clips: Array<{ clip_id: string; start_sec: number; end_sec: number }>;
  };
};

export type AssembleReelResult =
  | { ok: true; reel: AssembledReel }
  | { ok: false; skipped: string };

const score10 = z.preprocess(
  (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 5),
  z.number(),
);

const llmReelSchema = z.object({
  skip: z.boolean().optional(),
  skip_reason: z.string().optional(),
  title: z.string().optional(),
  hook: z.string().optional(),
  concept_summary: z.string().optional(),
  caption_fr: z.string().optional(),
  caption_en: z.string().optional(),
  hashtags: z.array(z.string()).optional().default([]),
  selected_series: z.string().optional(),
  clips: z
    .array(
      z.object({
        clip_id: z.string(),
        start_sec: z.number(),
        end_sec: z.number(),
        why: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  overlay_lines: z.array(z.string()).optional().default([]),
  reasoning: z
    .object({
      why_script_works: z.string().optional().default(''),
      why_clips_support_script: z.string().optional().default(''),
      emotional_contrast: z.string().optional().default(''),
      scroll_stop: z.string().optional().default(''),
      series_fit: z.string().optional().default(''),
      clips_vs_alternatives: z.string().optional().default(''),
    })
    .optional(),
  priority_score: score10.optional().default(5),
  mission_score: score10.optional().default(5),
  human_score: score10.optional().default(5),
  sponsor_safety_score: score10.optional().default(5),
});

export type ScoredReelSeries = {
  series: SeriesRow;
  matchingClipCount: number;
  score: number;
};

/**
 * Deterministic series scoring for reels: weight x matching-clip availability,
 * restricted to series with reels enabled.
 */
export function scoreSeriesForReels(
  series: SeriesRow[],
  clips: ClipWithAsset[],
): ScoredReelSeries[] {
  const eligible = series.filter(
    (s) => s.status === 'active' && s.weight > 0 && seriesAllowsPostType(s, 'reel'),
  );
  const scored = eligible.map((s) => {
    const matchingClipCount = clips.filter((c) => c.fitting_series_slugs.includes(s.slug)).length;
    return { series: s, matchingClipCount, score: s.weight * matchingClipCount };
  });

  const anyMatches = scored.some((s) => s.score > 0);
  if (!anyMatches) {
    // No tagged matches: fall back to weight ordering over the whole pool.
    return scored
      .map((s) => ({ ...s, matchingClipCount: clips.length, score: s.series.weight }))
      .sort((a, b) => b.score - a.score);
  }

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}

/** Clips matching the series first (newest first), padded with generic reel-friendly clips. */
export function selectClipPoolForSeries(
  clips: ClipWithAsset[],
  seriesSlug: string,
  max = 24,
): ClipWithAsset[] {
  const matching = clips.filter((c) => c.fitting_series_slugs.includes(seriesSlug));
  const rest = clips.filter((c) => !c.fitting_series_slugs.includes(seriesSlug));
  return [...matching, ...rest].slice(0, max);
}

function clipForPrompt(c: ClipWithAsset) {
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
    supported_reel_formats: c.supported_reel_formats,
    fitting_series_slugs: c.fitting_series_slugs,
    emotional_tags: c.emotional_tags,
    tension_tags: c.tension_tags,
    visual_tags: c.visual_tags,
    discovery_tags: c.discovery_tags,
    could_be_used_for: c.could_be_used_for,
  };
}

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

/**
 * Validate and clamp LLM clip selections against the real clip pool.
 * Returns null with a reason when the selection cannot make a valid reel.
 */
export function validateReelClipSelection(
  selections: Array<{ clip_id: string; start_sec: number; end_sec: number; why?: string }>,
  pool: Map<string, ClipWithAsset>,
): { clips: ReelSpecClip[]; totalSec: number } | { error: string } {
  if (selections.length === 0) return { error: 'no clips selected' };
  if (selections.length > REEL_MAX_CLIPS) {
    selections = selections.slice(0, REEL_MAX_CLIPS);
  }

  const clips: ReelSpecClip[] = [];
  for (const sel of selections) {
    const clip = pool.get(sel.clip_id);
    if (!clip) return { error: `unknown clip_id ${sel.clip_id}` };
    const clipStart = Number(clip.start_sec);
    const clipEnd = Number(clip.end_sec);
    const start = Math.max(clipStart, Math.min(sel.start_sec, clipEnd));
    const end = Math.min(clipEnd, Math.max(sel.end_sec, clipStart));
    if (end - start < 1) return { error: `clip ${sel.clip_id} trim too short after clamping` };
    clips.push({
      clip_id: clip.id,
      asset_id: clip.content_asset_id,
      drive_file_id: clip.asset.drive_file_id,
      start_sec: +start.toFixed(2),
      end_sec: +end.toFixed(2),
      why: sel.why,
    });
  }

  let totalSec = clips.reduce((sum, c) => sum + (c.end_sec - c.start_sec), 0);

  // Over budget: trim the last clip down to fit.
  if (totalSec > REEL_MAX_TOTAL_SEC) {
    const over = totalSec - REEL_MAX_TOTAL_SEC;
    const last = clips[clips.length - 1]!;
    const lastDur = last.end_sec - last.start_sec;
    if (lastDur - over >= 1) {
      last.end_sec = +(last.end_sec - over).toFixed(2);
      totalSec = REEL_MAX_TOTAL_SEC;
    } else {
      return { error: `total duration ${totalSec.toFixed(1)}s exceeds ${REEL_MAX_TOTAL_SEC}s` };
    }
  }

  // Tolerate slightly-short reels (>=8s) instead of failing the whole run.
  if (totalSec < 8) {
    return { error: `total duration ${totalSec.toFixed(1)}s is too short` };
  }

  return { clips, totalSec: +totalSec.toFixed(2) };
}

/** Parse a stored clips-v1 reel specification from post_candidates.reel_instructions. */
export function parseReelSpecification(raw: unknown): ReelSpecification | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 'clips-v1' || !Array.isArray(o.clips)) return null;
  const clips: ReelSpecClip[] = [];
  for (const x of o.clips) {
    if (x == null || typeof x !== 'object') continue;
    const row = x as Record<string, unknown>;
    const clip_id = typeof row.clip_id === 'string' ? row.clip_id : '';
    const asset_id = typeof row.asset_id === 'string' ? row.asset_id : '';
    const drive_file_id = typeof row.drive_file_id === 'string' ? row.drive_file_id : '';
    const start_sec = Number(row.start_sec);
    const end_sec = Number(row.end_sec);
    if (!clip_id || !asset_id || !Number.isFinite(start_sec) || !Number.isFinite(end_sec)) continue;
    clips.push({
      clip_id,
      asset_id,
      drive_file_id,
      start_sec,
      end_sec,
      why: typeof row.why === 'string' ? row.why : undefined,
    });
  }
  if (clips.length === 0) return null;
  const overlay_lines = Array.isArray(o.overlay_lines)
    ? o.overlay_lines.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : [];
  const total = Number(o.total_duration_sec);
  return {
    version: 'clips-v1',
    clips,
    overlay_lines,
    keep_audio: true,
    text_style: resolveReelTextStyle(parsePartialReelTextStyle(o.text_style)),
    total_duration_sec: Number.isFinite(total) ? total : clips.reduce((s, c) => s + (c.end_sec - c.start_sec), 0),
  };
}

/** Build the variant_request.base payload from an existing clip-based reel candidate. */
export function buildVariantBaseFromCandidate(candidate: {
  id: string;
  hook: string | null;
  selected_series: string | null;
  reel_instructions: unknown;
}): ReelVariantRequest['base'] | null {
  const spec = parseReelSpecification(candidate.reel_instructions);
  if (!spec) return null;
  return {
    candidate_id: candidate.id,
    hook: candidate.hook,
    selected_series: candidate.selected_series,
    overlay_lines: spec.overlay_lines,
    clips: spec.clips.map((c) => ({
      clip_id: c.clip_id,
      start_sec: c.start_sec,
      end_sec: c.end_sec,
    })),
  };
}

/** Pick the next-best series slug for a different-series variant. */
export function pickAlternateSeriesSlug(
  series: SeriesRow[],
  clips: ClipWithAsset[],
  currentSlug: string | null | undefined,
): string | undefined {
  const scored = scoreSeriesForReels(series, clips);
  const current = (currentSlug ?? '').trim();
  const alt = scored.find((s) => s.series.slug !== current);
  return alt?.series.slug;
}

/**
 * Core reel generation: retrieve pre-tagged clips, score series, ask the LLM to
 * select/refine (not invent), and return an assembled reel with reasoning.
 */
export async function assembleReelFromClips(params: {
  supabase: SupabaseClient;
  ai: GoogleGenAI;
  /** Force a target series (e.g. variant D); otherwise scored automatically. */
  targetSeriesSlug?: string;
  variant?: ReelVariantRequest;
  recentCommitted?: unknown[];
  clipPoolLimit?: number;
}): Promise<AssembleReelResult> {
  const { supabase, ai } = params;

  const [allSeries, allClips] = await Promise.all([
    loadActiveSeries(supabase),
    loadReadyClipsForReels(supabase, { limit: params.clipPoolLimit ?? 200 }),
  ]);

  if (allClips.length === 0) {
    return { ok: false, skipped: 'no ready content_clips available' };
  }

  const scored = scoreSeriesForReels(allSeries, allClips);
  if (scored.length === 0) {
    return { ok: false, skipped: 'no active series with reels enabled' };
  }

  let target: SeriesRow | undefined;
  if (params.targetSeriesSlug) {
    target = allSeries.find((s) => s.slug === params.targetSeriesSlug);
    if (!target) {
      return { ok: false, skipped: `target series not found: ${params.targetSeriesSlug}` };
    }
  } else {
    target = scored[0]!.series;
  }

  const pool = selectClipPoolForSeries(allClips, target.slug);
  const poolById = new Map(pool.map((c) => [c.id, c]));

  const route = await getResolvedModelRoute(supabase, 'candidate_generation');
  const composed = await loadComposedStableSystemInstruction(supabase, 'task_reel_reasoning');
  const stable = appendSeriesToSystemInstruction(composed.text, [target]);
  const workspaceTextStyle = await loadReelRenderDefaults(supabase);

  const payload: Record<string, unknown> = {
    target_series: seriesForPrompt(target),
    constraints: {
      min_clips: 1,
      max_clips: REEL_MAX_CLIPS,
      min_total_sec: REEL_MIN_TOTAL_SEC,
      max_total_sec: REEL_MAX_TOTAL_SEC,
      keep_original_audio: true,
      text_style: workspaceTextStyle,
    },
    clips: pool.map(clipForPrompt),
  };
  if (params.variant) {
    payload.variant_request = {
      kind: params.variant.kind,
      base_candidate: params.variant.base,
    };
  }
  if (params.recentCommitted && params.recentCommitted.length > 0) {
    payload.recent_committed = params.recentCommitted;
  }
  const dynamic = `Dynamic payload (JSON):\n${JSON.stringify(payload, null, 2)}`;

  const promptVersion = getFr94PromptVersion();
  const { response, modelUsed } = await callGeminiWithLogging({
    ai,
    supabase,
    route,
    subOperation: params.variant ? `reel_variant_${params.variant.kind}` : 'reel_assembly',
    promptVersion,
    cacheKey: cacheKeyCandidateGeneration(promptVersion, stable),
    stableSystemInstruction: stable,
    entity: {
      prompt_keys: ['task_reel_reasoning'],
      pipeline_step: 'reel_assembly',
    },
    getContentsImplicit: () => [createPartFromText(`${stable}\n\n${dynamic}`)],
    getContentsExplicit: () => [createPartFromText(dynamic)],
  });

  const text = response.text?.trim();
  if (!text) {
    return { ok: false, skipped: 'LLM returned empty text' };
  }

  const json = parseGeminiJsonObject(text);
  const parsed = llmReelSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, skipped: `invalid reel schema: ${parsed.error.message.slice(0, 300)}` };
  }
  const out = parsed.data;

  if (out.skip) {
    return { ok: false, skipped: out.skip_reason || 'LLM skipped (no viable reel)' };
  }
  if (!out.hook?.trim() || !out.caption_fr?.trim()) {
    return { ok: false, skipped: 'LLM output missing hook or caption_fr' };
  }

  const validated = validateReelClipSelection(out.clips, poolById);
  if ('error' in validated) {
    return { ok: false, skipped: `clip selection invalid: ${validated.error}` };
  }

  const hook = out.hook.trim();
  const overlayLines = out.overlay_lines.map((l) => l.trim()).filter(Boolean);
  if (overlayLines.length === 0) {
    overlayLines.push(hook);
  } else if (hook.length > overlayLines[0]!.length && hook.startsWith(overlayLines[0]!)) {
    overlayLines[0] = hook;
  }

  const spec: ReelSpecification = {
    version: 'clips-v1',
    clips: validated.clips,
    overlay_lines: overlayLines.slice(0, 2),
    keep_audio: true,
    text_style: workspaceTextStyle,
    total_duration_sec: validated.totalSec,
  };

  const reasoning: ReelReasoning = {
    why_script_works: out.reasoning?.why_script_works ?? '',
    why_clips_support_script: out.reasoning?.why_clips_support_script ?? '',
    emotional_contrast: out.reasoning?.emotional_contrast ?? '',
    scroll_stop: out.reasoning?.scroll_stop ?? '',
    series_fit: out.reasoning?.series_fit ?? '',
    clips_vs_alternatives: out.reasoning?.clips_vs_alternatives ?? '',
  };

  const sourceAssetIds = [...new Set(validated.clips.map((c) => c.asset_id))];
  const sourceDriveFileIds = [...new Set(validated.clips.map((c) => c.drive_file_id))];

  return {
    ok: true,
    reel: {
      title: out.title?.trim() || out.hook.trim().slice(0, 80),
      hook: out.hook.trim(),
      concept_summary: out.concept_summary?.trim() || '',
      caption_fr: out.caption_fr.trim(),
      caption_en: out.caption_en?.trim() || null,
      hashtags: out.hashtags,
      selected_series: out.selected_series?.trim() || target.slug,
      spec,
      reasoning,
      selected_clip_ids: validated.clips.map((c) => c.clip_id),
      source_asset_ids: sourceAssetIds,
      source_drive_file_ids: sourceDriveFileIds,
      priority_score: out.priority_score,
      mission_score: out.mission_score,
      human_score: out.human_score,
      sponsor_safety_score: out.sponsor_safety_score,
      llmModel: modelUsed,
      llmRaw: responseToJson(response),
    },
  };
}

/** Insert a clip-based reel candidate row (status needs_review). Returns the new id. */
export async function insertReelCandidate(
  supabase: SupabaseClient,
  params: {
    reel: AssembledReel;
    candidateDate: string;
    variantOf?: string;
    variantKind?: ReelVariantKind;
  },
): Promise<{ id: string; error: string | null }> {
  const { reel } = params;
  const id = randomUUID();
  const now = new Date().toISOString();

  const { error } = await supabase.from('post_candidates').insert({
    id,
    candidate_date: params.candidateDate,
    platform: 'instagram',
    post_type: 'reel',
    title: reel.title,
    hook: reel.hook,
    concept_summary: reel.concept_summary || null,
    rationale: null,
    caption_fr: reel.caption_fr,
    caption_en: reel.caption_en,
    hashtags: reel.hashtags,
    story_frames: [],
    reel_instructions: reel.spec,
    carousel_slides: [],
    static_post_instructions: {},
    source_asset_ids: reel.source_asset_ids,
    source_drive_file_ids: reel.source_drive_file_ids,
    priority_score: reel.priority_score,
    mission_score: reel.mission_score,
    human_score: reel.human_score,
    sponsor_safety_score: reel.sponsor_safety_score,
    effort_score: 2,
    status: 'needs_review',
    selected_series: reel.selected_series,
    title_overlay: reel.spec.overlay_lines[0] ?? reel.hook,
    selected_clip_ids: reel.selected_clip_ids,
    reel_reasoning: reel.reasoning,
    variant_of: params.variantOf ?? null,
    variant_kind: params.variantKind ?? null,
    llm_model: reel.llmModel,
    llm_raw: reel.llmRaw,
    updated_at: now,
  });

  if (error) return { id, error: error.message };
  return { id, error: null };
}

/** Enqueue (or reset) the render job for a reel candidate so the render worker picks it up. */
export async function enqueueReelRenderJob(
  supabase: SupabaseClient,
  params: { candidateId: string; reel: AssembledReel },
): Promise<{ error: string | null }> {
  const { reel } = params;
  const now = new Date().toISOString();

  const { error } = await supabase.from('production_jobs').upsert(
    {
      post_candidate_id: params.candidateId,
      production_type: 'reel',
      status: 'queued',
      source_asset_ids: reel.source_asset_ids,
      source_drive_file_ids: reel.source_drive_file_ids,
      instructions: reel.spec,
      reel_specification: reel.spec,
      error_message: null,
      updated_at: now,
    },
    { onConflict: 'post_candidate_id,production_type' },
  );

  if (error) return { error: error.message };
  return { error: null };
}
