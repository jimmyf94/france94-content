import type { GoogleGenAI } from '@google/genai';
import { createPartFromText } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { SeriesRow } from '../content-series.js';
import { callGeminiWithLogging, getResolvedModelRoute } from './gemini-client.js';
import { parseGeminiJsonObject } from './parse-gemini-json.js';
import type { ResolvedModelRoute } from './model-routes.js';

/** Minimal asset fields sent to the target-planning Flash call. */
export type FitScoringAsset = {
  id: string;
  activity: string | null;
  content_lane: string | null;
  tags: string[] | null;
  suggested_title: string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  media_type: string | null;
  is_fresh_for_story: boolean;
};

export type GenerationTarget = {
  seriesSlug: string;
  postTypeHint: string;
  assetIds: string[];
  fitScore: number;
  reason: string;
};

export type ScoredTarget = GenerationTarget & {
  seriesWeight: number;
};

export type BundleClampOpts = {
  carouselMax: number;
  storyMax: number;
};

const IMAGE_VIDEO = new Set(['image', 'video']);

function truncateText(text: string | null | undefined, maxLen: number): string | null {
  if (!text?.trim()) return null;
  const t = text.trim();
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
}

function seriesBrief(bodyMd: string, maxLen = 200): string {
  const flat = bodyMd.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length <= maxLen ? flat : `${flat.slice(0, maxLen - 1)}…`;
}

function clampFitScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, n));
}

function buildTargetPlanningPrompt(
  assets: FitScoringAsset[],
  series: SeriesRow[],
  enabledPostTypes: string[],
): string {
  const assetPayload = assets.map((a) => ({
    id: a.id,
    activity: a.activity,
    content_lane: a.content_lane,
    media_type: a.media_type,
    is_fresh_for_story: a.is_fresh_for_story,
    tags: a.tags,
    suggested_title: a.suggested_title,
    visual_summary: truncateText(a.visual_summary, 200),
    semantic_summary: truncateText(a.semantic_summary, 200),
  }));

  const seriesPayload = series.map((s) => ({
    slug: s.slug,
    name: s.name,
    weight: s.weight,
    brief: seriesBrief(s.body_md),
  }));

  const payload = {
    assets: assetPayload,
    series: seriesPayload,
    enabled_post_types: enabledPostTypes,
    bundle_guidance: {
      carousel: '3-6 image/video assets (max 10)',
      story_sequence: '3-5 fresh assets (is_fresh_for_story=true)',
      reel: '1 video asset',
      static_post: '1 asset',
      sponsor_post: '1 asset',
      archive_note: '1 asset',
    },
  };

  return [
    'Plan Instagram post generation targets: pick series + post_type_hint + asset bundle.',
    'Return strict JSON only (no markdown fences):',
    '{ "targets": [ { "series_slug": "<slug>", "post_type_hint": "<type>", "asset_ids": ["uuid", ...], "fit_score": 0-10, "reason": "short" } ] }',
    '',
    'Rules:',
    '- post_type_hint must be one of enabled_post_types.',
    '- carousel/story_sequence: bundle multiple assets; reel/static/sponsor/archive: single asset.',
    '- Examples: map/route assets -> carto-porn carousel; talking-head clip -> data-brain reel.',
    '- Propose diverse targets across series and formats when assets allow.',
    '',
    `Input JSON:\n${JSON.stringify(payload, null, 2)}`,
  ].join('\n');
}

/** Parse and validate target-planning LLM response. Exported for unit tests. */
export function parseGenerationTargetsResponse(
  obj: Record<string, unknown>,
  validAssetIds: Set<string>,
  validSeriesSlugs: Set<string>,
  enabledPostTypes: Set<string>,
): GenerationTarget[] {
  const rawTargets = obj.targets;
  if (!Array.isArray(rawTargets)) return [];

  const out: GenerationTarget[] = [];
  for (const row of rawTargets) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const seriesSlug = typeof r.series_slug === 'string' ? r.series_slug.trim() : '';
    const postTypeHint =
      typeof r.post_type_hint === 'string' ? r.post_type_hint.trim() : '';
    if (!seriesSlug || !postTypeHint) continue;
    if (!validSeriesSlugs.has(seriesSlug) || !enabledPostTypes.has(postTypeHint)) continue;

    const rawIds = r.asset_ids;
    if (!Array.isArray(rawIds)) continue;
    const assetIds: string[] = [];
    for (const id of rawIds) {
      if (typeof id !== 'string') continue;
      const trimmed = id.trim();
      if (validAssetIds.has(trimmed) && !assetIds.includes(trimmed)) {
        assetIds.push(trimmed);
      }
    }
    if (assetIds.length === 0) continue;

    out.push({
      seriesSlug,
      postTypeHint,
      assetIds,
      fitScore: clampFitScore(r.fit_score),
      reason: typeof r.reason === 'string' ? r.reason.trim() : '',
    });
  }
  return out;
}

export function toFitScoringAsset(asset: {
  id: string;
  activity: string | null;
  content_lane: string | null;
  tags: string[] | null;
  suggested_title: string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  media_type: string | null;
  is_fresh_for_story: boolean;
}): FitScoringAsset {
  return {
    id: asset.id,
    activity: asset.activity,
    content_lane: asset.content_lane,
    tags: asset.tags,
    suggested_title: asset.suggested_title,
    visual_summary: asset.visual_summary,
    semantic_summary: asset.semantic_summary,
    media_type: asset.media_type,
    is_fresh_for_story: asset.is_fresh_for_story,
  };
}

function isImageOrVideo(mediaType: string | null): boolean {
  if (!mediaType?.trim()) return true;
  return IMAGE_VIDEO.has(mediaType.trim().toLowerCase());
}

/**
 * Clamp asset bundle to post-type rules. Returns [] when bundle is invalid.
 * Exported for unit tests.
 */
export function clampBundleForType(
  postType: string,
  assetIds: string[],
  assetsById: Map<string, FitScoringAsset>,
  opts: BundleClampOpts,
): string[] {
  const resolved = assetIds
    .map((id) => assetsById.get(id))
    .filter((a): a is FitScoringAsset => a != null);

  if (resolved.length === 0) return [];

  switch (postType) {
    case 'carousel': {
      const media = resolved.filter((a) => isImageOrVideo(a.media_type));
      const capped = media.slice(0, Math.min(opts.carouselMax, 10));
      return capped.length >= 2 ? capped.map((a) => a.id) : [];
    }
    case 'story_sequence': {
      const fresh = resolved.filter((a) => a.is_fresh_for_story);
      const capped = fresh.slice(0, opts.storyMax);
      return capped.length >= 2 ? capped.map((a) => a.id) : [];
    }
    case 'reel': {
      const video = resolved.find((a) => a.media_type?.trim().toLowerCase() === 'video');
      const pick = video ?? resolved[0];
      return pick ? [pick.id] : [];
    }
    case 'static_post':
    case 'sponsor_post':
    case 'archive_note':
      return [resolved[0]!.id];
    default:
      return [resolved[0]!.id];
  }
}

export async function planGenerationTargetsWithLLM(params: {
  ai: GoogleGenAI;
  supabase: SupabaseClient | null;
  promptVersion: string;
  assets: FitScoringAsset[];
  series: SeriesRow[];
  enabledPostTypes: string[];
  route?: ResolvedModelRoute;
}): Promise<GenerationTarget[]> {
  if (params.assets.length === 0 || params.series.length === 0) return [];

  const route =
    params.route ?? (await getResolvedModelRoute(params.supabase, 'ranking'));
  const prompt = buildTargetPlanningPrompt(
    params.assets,
    params.series,
    params.enabledPostTypes,
  );
  const validAssetIds = new Set(params.assets.map((a) => a.id));
  const validSeriesSlugs = new Set(params.series.map((s) => s.slug));
  const enabledSet = new Set(params.enabledPostTypes);

  const { response } = await callGeminiWithLogging({
    ai: params.ai,
    supabase: params.supabase,
    route,
    subOperation: 'asset_series_targets',
    promptVersion: params.promptVersion,
    cacheKey: `asset_series_targets:${params.promptVersion}:${params.assets.length}:${params.series.length}`,
    stableSystemInstruction: '',
    disableExplicitCaching: true,
    entity: { pipeline_step: 'asset_series_targets' },
    getContentsImplicit: () => [createPartFromText(prompt)],
    getContentsExplicit: () => [createPartFromText(prompt)],
  });

  const text = response.text?.trim() ?? '';
  if (!text) return [];

  const obj = parseGeminiJsonObject(text);
  return parseGenerationTargetsResponse(obj, validAssetIds, validSeriesSlugs, enabledSet);
}

/** Clamp top-target count to 2–4. */
export function clampTopTargets(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(4, Math.max(2, Math.round(n)));
}

/**
 * Select top generation targets: fit score primary, series weight tie-break.
 * Prefers distinct primary assets; applies bundle clamping per post type.
 */
export function selectTopTargets(
  targets: GenerationTarget[],
  series: SeriesRow[],
  assetsById: Map<string, FitScoringAsset>,
  maxTargets: number,
  bundleOpts: BundleClampOpts,
): ScoredTarget[] {
  const cap = clampTopTargets(maxTargets);
  if (targets.length === 0 || series.length === 0) return [];

  const weightBySlug = new Map(series.map((s) => [s.slug, Math.max(0, s.weight)]));

  const scored: ScoredTarget[] = [];
  for (const t of targets) {
    const clampedIds = clampBundleForType(t.postTypeHint, t.assetIds, assetsById, bundleOpts);
    if (clampedIds.length === 0) continue;
    scored.push({
      ...t,
      assetIds: clampedIds,
      seriesWeight: weightBySlug.get(t.seriesSlug) ?? 0,
    });
  }

  scored.sort((a, b) => {
    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
    if (b.seriesWeight !== a.seriesWeight) return b.seriesWeight - a.seriesWeight;
    const aPrimary = a.assetIds[0] ?? '';
    const bPrimary = b.assetIds[0] ?? '';
    if (aPrimary !== bPrimary) return aPrimary.localeCompare(bPrimary);
    return a.seriesSlug.localeCompare(b.seriesSlug);
  });

  const selected: ScoredTarget[] = [];
  const usedPrimaryAssets = new Set<string>();

  for (const target of scored) {
    if (selected.length >= cap) break;
    const primary = target.assetIds[0];
    if (!primary || usedPrimaryAssets.has(primary)) continue;
    selected.push(target);
    usedPrimaryAssets.add(primary);
  }

  return selected;
}
