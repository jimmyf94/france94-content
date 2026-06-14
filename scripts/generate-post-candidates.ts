import 'dotenv/config';

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createPartFromText } from '@google/genai';
import type { drive_v3 } from 'googleapis';
import { z } from 'zod';

import { getDriveClient } from './ingest-drive-content.js';
import { formatGoogleDriveApiError } from './lib/google-drive-auth.js';
import { sanitizeFilenamePart } from './process-analyzed-assets.js';
import {
  callGeminiWithLogging,
  createGeminiClient,
  formatGeminiFetchError,
  getResolvedModelRoute,
  responseToJson,
} from './lib/ai/gemini-client.js';
import { parseGeminiJsonObject } from './lib/ai/parse-gemini-json.js';
import { loadComposedStableSystemInstruction, STABLE_CONTEXT_KEYS } from './lib/ai/resolve-stable-prompt.js';
import { cacheKeyCandidateGeneration, getFr94PromptVersion } from './lib/ai/prompt-version.js';
import { buildPostPlannerDynamicText } from './lib/ai/prompts/post-planner.js';
import {
  computeLaneCooldownUntil,
  isFreshForStory,
  mapPostTypeToUsageType,
  recordAssetUsageEvent,
  refreshCandidateAssetConflicts,
  updateAssetUsageSummary,
} from './lib/asset-usage.js';
import { evaluateCandidateCollision } from './lib/candidate-collision-check.js';
import { loadRecentLedgerContext, toCommittedPostForPrompt } from './lib/content-ledger.js';
import { getFirstReviewFolderThumbnailLink } from './lib/review-folder-thumbnail.js';
import {
  loadComposedSystemInstructionWithSeries,
  type SeriesRow,
} from './lib/content-series.js';
import { rankAndCapPlannerAssets } from './lib/planner-asset-ranking.js';
import {
  planGenerationTargetsWithLLM,
  selectTopTargets,
  toFitScoringAsset,
  type ScoredTarget,
} from './lib/ai/asset-series-fit.js';
import { loadReadyClipsForReels } from './lib/content-clips.js';
import {
  assembleReelFromClips,
  enqueueReelRenderJob,
  insertReelCandidate,
} from './lib/reel-assembly.js';
import { loadAutoReelRenderEnabled } from './lib/pipeline-settings.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const ALL_POST_TYPES = [
  'reel',
  'story_sequence',
  'carousel',
  'static_post',
  'sponsor_post',
  'archive_note',
] as const;

const postTypeEnum = z.enum(ALL_POST_TYPES);

const llmCandidateSchema = z.object({
  post_type: postTypeEnum,
  title: z.string(),
  hook: z.string().optional(),
  concept_summary: z.string().optional(),
  rationale: z.string().optional(),
  caption_fr: z.string(),
  caption_en: z.string().optional(),
  hashtags: z.array(z.string()),
  source_asset_ids: z.array(z.string()),
  source_drive_file_ids: z.array(z.string()),
  priority_score: z.number().min(0).max(10).optional().default(5),
  mission_score: z.number().min(0).max(10).optional().default(5),
  human_score: z.number().min(0).max(10).optional().default(5),
  sponsor_safety_score: z.number().min(0).max(10).optional().default(5),
  effort_score: z.number().min(0).max(10).optional().default(5),
  story_frames: z.any().optional(),
  reel_instructions: z.any().optional(),
  carousel_slides: z.any().optional(),
  static_post_instructions: z.any().optional(),
  selected_series: z.string().optional(),
  narrative_function: z.string().optional(),
  series_reasoning: z.string().optional(),
  target_audience: z.string().optional(),
  asset_fit_score: z.number().min(0).max(10).optional(),
  caption_strategy: z.string().optional(),
  overlay_strategy: z.string().optional(),
  cta_strategy: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

const llmResponseLooseSchema = z.object({
  candidates: z.array(z.unknown()),
});

export type CandidateSourceAsset = {
  id: string;
  drive_file_id: string;
  current_filename: string | null;
  final_filename: string | null;
  media_type: string | null;
  activity: string | null;
  content_lane: string | null;
  suggested_title: string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  transcript: string | null;
  audio_transcript: string | null;
  tags: string[] | null;
  quality_score: number | string | null;
  mission_score: number | string | null;
  human_score: number | string | null;
  sponsor_safety_score: number | string | null;
  processed_at: string | null;
  geo_label: string | null;
  geo_locality: string | null;
  postal_code: string | null;
  duration_seconds: number | string | null;
  drive_web_view_link: string | null;
  analysis_status: string | null;
  capture_time?: string | null;
  drive_created_time?: string | null;
  imported_at?: string | null;
  usage_status?: string | null;
  hard_locked?: boolean | null;
  reuse_allowed_after?: string | null;
  candidate_eligibility?: string | null;
};

export type AssetSummaryForLLM = {
  id: string;
  drive_file_id: string;
  current_filename: string | null;
  final_filename: string | null;
  media_type: string | null;
  activity: string | null;
  content_lane: string | null;
  suggested_title: string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  transcript_excerpt: string | null;
  audio_transcript_excerpt: string | null;
  tags: string[] | null;
  quality_score: number | string | null;
  mission_score: number | string | null;
  human_score: number | string | null;
  sponsor_safety_score: number | string | null;
  location_guess: string | null;
  postal_code: string | null;
  duration_seconds: number | string | null;
  drive_review_link: string | null;
  /** True when asset effective date is within STORY_FRESHNESS_HOURS (for planner hints). */
  is_fresh_for_story: boolean;
  usage_status: string;
  candidate_eligibility?: string;
};

export type ValidatedPostCandidate = z.infer<typeof llmCandidateSchema> & {
  source_drive_file_ids: string[];
};

/** Internal: per-pair generation attaches its own raw LLM response. */
export type ValidatedPostCandidateWithRaw = ValidatedPostCandidate & {
  _llmRaw?: Record<string, unknown>;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

/** Candidates requested per LLM planner call (capped 1–5). */
function plannerLlmTarget(): number {
  const raw = process.env.POST_CANDIDATE_LLM_TARGET?.trim();
  const fromEnv = raw ? Number.parseInt(raw, 10) : NaN;
  const fallback = envInt('POST_CANDIDATE_DAILY_TARGET', 4);
  const n = Number.isFinite(fromEnv) && fromEnv >= 1 ? fromEnv : fallback;
  return Math.min(Math.max(n, 1), 5);
}

function plannerMaxAssets(): number {
  return envInt('POST_CANDIDATE_PLANNER_MAX_ASSETS', 15);
}

/** Top generation targets per run (clamped 2–4). */
function plannerTopPairs(): number {
  const raw = process.env.POST_CANDIDATE_TOP_PAIRS?.trim();
  const fromEnv = raw ? Number.parseInt(raw, 10) : NaN;
  const n = Number.isFinite(fromEnv) && fromEnv >= 1 ? fromEnv : 3;
  return Math.min(Math.max(n, 2), 4);
}

function plannerCarouselMaxAssets(): number {
  const raw = process.env.POST_CANDIDATE_CAROUSEL_MAX_ASSETS?.trim();
  const fromEnv = raw ? Number.parseInt(raw, 10) : NaN;
  const n = Number.isFinite(fromEnv) && fromEnv >= 1 ? fromEnv : 6;
  return Math.min(Math.max(n, 3), 10);
}

function plannerStoryMaxAssets(): number {
  const raw = process.env.POST_CANDIDATE_STORY_MAX_ASSETS?.trim();
  const fromEnv = raw ? Number.parseInt(raw, 10) : NaN;
  const n = Number.isFinite(fromEnv) && fromEnv >= 1 ? fromEnv : 5;
  return Math.min(Math.max(n, 2), 7);
}

function utcDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function truncateText(s: string | null | undefined, max: number): string | null {
  if (s == null || !String(s).trim()) return null;
  const t = String(s).trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function normalizeDedupeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storyFramesValue(v: unknown): unknown[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  return null;
}

function jsonObjectValue(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function buildAssetSummaryForLLM(asset: CandidateSourceAsset, excerptLen = 400): AssetSummaryForLLM {
  const location =
    asset.geo_locality?.trim() ||
    (asset.geo_label?.trim() ? asset.geo_label.split(',')[0]?.trim() ?? null : null) ||
    null;

  return {
    id: asset.id,
    drive_file_id: asset.drive_file_id,
    current_filename: asset.current_filename,
    final_filename: asset.final_filename,
    media_type: asset.media_type,
    activity: asset.activity,
    content_lane: asset.content_lane,
    suggested_title: asset.suggested_title,
    visual_summary: truncateText(asset.visual_summary, excerptLen),
    semantic_summary: truncateText(asset.semantic_summary, excerptLen),
    transcript_excerpt: truncateText(asset.transcript, excerptLen),
    audio_transcript_excerpt: truncateText(asset.audio_transcript, excerptLen),
    tags: asset.tags,
    quality_score: asset.quality_score,
    mission_score: asset.mission_score,
    human_score: asset.human_score,
    sponsor_safety_score: asset.sponsor_safety_score,
    location_guess: location,
    postal_code: asset.postal_code,
    duration_seconds: asset.duration_seconds,
    drive_review_link: asset.drive_web_view_link?.trim() || null,
    is_fresh_for_story: isFreshForStory(asset),
    usage_status: (asset.usage_status ?? 'unused').trim() || 'unused',
    candidate_eligibility: (asset.candidate_eligibility ?? 'eligible').trim() || 'eligible',
  };
}

export async function getCandidateSourceAssets(
  supabase: SupabaseClient,
  params: { maxAssets: number },
): Promise<CandidateSourceAsset[]> {
  const fetchLimit = Math.min(Math.max(params.maxAssets * 4, params.maxAssets), 500);

  const { data, error } = await supabase
    .from('content_assets')
    .select(
      [
        'id',
        'drive_file_id',
        'current_filename',
        'final_filename',
        'media_type',
        'activity',
        'content_lane',
        'suggested_title',
        'visual_summary',
        'semantic_summary',
        'transcript',
        'audio_transcript',
        'tags',
        'quality_score',
        'mission_score',
        'human_score',
        'sponsor_safety_score',
        'processed_at',
        'capture_time',
        'drive_created_time',
        'imported_at',
        'geo_label',
        'geo_locality',
        'postal_code',
        'duration_seconds',
        'drive_web_view_link',
        'analysis_status',
        'usage_status',
        'hard_locked',
        'candidate_eligibility',
      ].join(', '),
    )
    .eq('status', 'processed')
    .eq('analysis_status', 'complete')
    .in('candidate_eligibility', ['eligible', 'needs_review'])
    .not('quality_score', 'is', null)
    .or('content_lane.is.null,content_lane.neq.archive')
    .order('processed_at', { ascending: false })
    .limit(fetchLimit);

  if (error) throw error;
  const rows = data ?? [];
  return rows.slice(0, params.maxAssets) as unknown as CandidateSourceAsset[];
}

async function fetchExistingTitlesForDate(
  supabase: SupabaseClient,
  candidateDate: string,
): Promise<Set<string>> {
  const { data, error } = await supabase.from('post_candidates').select('title').eq('candidate_date', candidateDate);

  if (error) throw error;
  const set = new Set<string>();
  for (const row of data ?? []) {
    const t = (row as { title?: string | null }).title;
    if (t?.trim()) set.add(normalizeDedupeTitle(t));
  }
  return set;
}

const REJECTED_FEEDBACK_DAYS = 90;
const REJECTED_FEEDBACK_LIMIT = 50;

export type RejectedCandidateRow = {
  post_type: string;
  title: string;
  hook: string | null;
  concept_summary: string | null;
  caption_fr: string | null;
  source_asset_ids: string[];
  reviewer_notes: string | null;
  reviewed_at: string | null;
  updated_at: string | null;
};

export type RejectedFeedbackItem = {
  post_type: string;
  title: string;
  hook?: string;
  concept_summary?: string;
  caption_fr?: string;
  source_asset_ids: string[];
  reviewer_notes?: string;
  reviewed_at?: string;
};

export type RejectedIndexEntry = {
  postType: string;
  assetKey: string;
  normTitle: string;
  normHook: string;
};

export type RejectedIndex = {
  normalizedTitles: Set<string>;
  byAssets: RejectedIndexEntry[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function buildAssetKey(assetIds: string[]): string {
  return [...assetIds].sort().join(',');
}

function normalizeMatchText(text: string | null | undefined): string {
  if (!text?.trim()) return '';
  return normalizeDedupeTitle(text);
}

export function buildRejectedFeedbackForPrompt(rows: RejectedCandidateRow[]): RejectedFeedbackItem[] {
  return rows.map((r) => {
    const item: RejectedFeedbackItem = {
      post_type: r.post_type,
      title: r.title,
      source_asset_ids: r.source_asset_ids,
    };
    const hook = r.hook?.trim();
    if (hook) item.hook = hook;
    const concept = truncateText(r.concept_summary, 200);
    if (concept) item.concept_summary = concept;
    const caption = truncateText(r.caption_fr, 200);
    if (caption) item.caption_fr = caption;
    const notes = r.reviewer_notes?.trim();
    if (notes) item.reviewer_notes = notes;
    if (r.reviewed_at) item.reviewed_at = r.reviewed_at;
    return item;
  });
}

export function buildRejectedIndex(rows: RejectedCandidateRow[]): RejectedIndex {
  const normalizedTitles = new Set<string>();
  const byAssets: RejectedIndexEntry[] = [];

  for (const r of rows) {
    const normTitle = normalizeMatchText(r.title);
    if (normTitle) normalizedTitles.add(normTitle);

    byAssets.push({
      postType: r.post_type,
      assetKey: buildAssetKey(r.source_asset_ids),
      normTitle,
      normHook: normalizeMatchText(r.hook),
    });
  }

  return { normalizedTitles, byAssets };
}

export async function fetchRecentRejectedCandidates(
  supabase: SupabaseClient,
  params: { days?: number; limit?: number } = {},
): Promise<RejectedCandidateRow[]> {
  const days = params.days ?? REJECTED_FEEDBACK_DAYS;
  const limit = params.limit ?? REJECTED_FEEDBACK_LIMIT;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const { data, error } = await supabase
    .from('post_candidates')
    .select(
      'post_type, title, hook, concept_summary, caption_fr, source_asset_ids, reviewer_notes, reviewed_at, updated_at',
    )
    .eq('status', 'rejected')
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const out: RejectedCandidateRow[] = [];
  for (const row of data ?? []) {
    const r = row as {
      post_type?: string | null;
      title?: string | null;
      hook?: string | null;
      concept_summary?: string | null;
      caption_fr?: string | null;
      source_asset_ids?: unknown;
      reviewer_notes?: string | null;
      reviewed_at?: string | null;
      updated_at?: string | null;
    };
    const title = r.title?.trim();
    const postType = r.post_type?.trim();
    if (!title || !postType) continue;

    const reviewedAt = r.reviewed_at?.trim() || null;
    const updatedAt = r.updated_at?.trim() || null;
    const feedbackAt = reviewedAt ?? updatedAt;
    if (feedbackAt && Date.parse(feedbackAt) < cutoffMs) continue;

    out.push({
      post_type: postType,
      title,
      hook: r.hook?.trim() || null,
      concept_summary: r.concept_summary?.trim() || null,
      caption_fr: r.caption_fr?.trim() || null,
      source_asset_ids: asStringArray(r.source_asset_ids),
      reviewer_notes: r.reviewer_notes?.trim() || null,
      reviewed_at: reviewedAt,
      updated_at: updatedAt,
    });
  }

  return out;
}

export function getRejectedSkipReason(
  candidate: ValidatedPostCandidate,
  index: RejectedIndex,
): string | null {
  const normTitle = normalizeMatchText(candidate.title);
  if (normTitle && index.normalizedTitles.has(normTitle)) {
    return 'title matches rejected candidate';
  }

  const assetKey = buildAssetKey(candidate.source_asset_ids);
  const normHook = normalizeMatchText(candidate.hook);

  for (const entry of index.byAssets) {
    if (entry.postType !== candidate.post_type) continue;
    if (entry.assetKey !== assetKey) continue;
    if (normTitle && entry.normTitle === normTitle) {
      return 'same post_type, assets, and title as rejected candidate';
    }
    if (normHook && entry.normHook && entry.normHook === normHook) {
      return 'same post_type, assets, and hook as rejected candidate';
    }
  }

  return null;
}

export function buildAssetLookupMaps(
  summaries: AssetSummaryForLLM[],
): {
  assetById: Map<string, CandidateSourceAsset>;
  assetByDriveId: Map<string, CandidateSourceAsset>;
} {
  const assetById = new Map<string, CandidateSourceAsset>();
  const assetByDriveId = new Map<string, CandidateSourceAsset>();

  for (const s of summaries) {
    const asset = {
      id: s.id,
      drive_file_id: s.drive_file_id,
      current_filename: s.current_filename,
      final_filename: s.final_filename,
      media_type: s.media_type,
      activity: s.activity,
      content_lane: s.content_lane,
      suggested_title: s.suggested_title,
      visual_summary: s.visual_summary,
      semantic_summary: s.semantic_summary,
      transcript: null,
      audio_transcript: null,
      tags: s.tags,
      quality_score: s.quality_score,
      mission_score: s.mission_score,
      human_score: s.human_score,
      sponsor_safety_score: s.sponsor_safety_score,
      processed_at: null,
      geo_label: null,
      geo_locality: s.location_guess,
      postal_code: s.postal_code,
      duration_seconds: s.duration_seconds,
      drive_web_view_link: s.drive_review_link,
      analysis_status: 'complete',
      usage_status: s.usage_status,
      capture_time: null,
      drive_created_time: null,
      imported_at: null,
      hard_locked: false,
      reuse_allowed_after: null,
    } as CandidateSourceAsset;

    assetById.set(s.id, asset);
    if (s.drive_file_id) {
      assetByDriveId.set(s.drive_file_id, asset);
    }
  }

  return { assetById, assetByDriveId };
}

function resolveSourceAssetRef(
  raw: string,
  assetById: Map<string, CandidateSourceAsset>,
  assetByDriveId: Map<string, CandidateSourceAsset>,
): CandidateSourceAsset | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return assetById.get(trimmed) ?? assetByDriveId.get(trimmed) ?? null;
}

export function resolveSourceAssetIds(
  rawIds: string[],
  rawDriveIds: string[],
  assetById: Map<string, CandidateSourceAsset>,
  assetByDriveId: Map<string, CandidateSourceAsset>,
): { ids: string[]; driveIds: string[]; repairs: string[] } | { error: string } {
  const repairs: string[] = [];
  const resolvedIds: string[] = [];
  const resolvedDriveIds: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rawIds.length; i++) {
    const raw = rawIds[i]?.trim() ?? '';
    if (!raw) {
      return { error: `empty source_asset_ids entry at index ${i}` };
    }

    let asset = resolveSourceAssetRef(raw, assetById, assetByDriveId);
    if (!asset && rawDriveIds.length === rawIds.length) {
      const driveRaw = rawDriveIds[i]?.trim() ?? '';
      if (driveRaw) {
        asset = assetByDriveId.get(driveRaw) ?? null;
        if (asset) {
          repairs.push(`source_asset_ids[${i}]: paired via source_drive_file_ids[${i}]`);
        }
      }
    }

    if (!asset) {
      return { error: `unknown asset id ${raw}` };
    }

    if (raw !== asset.id && !assetById.has(raw)) {
      repairs.push(`source_asset_ids[${i}]: ${raw} -> ${asset.id}`);
    }

    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    resolvedIds.push(asset.id);
    resolvedDriveIds.push(asset.drive_file_id);
  }

  return { ids: resolvedIds, driveIds: resolvedDriveIds, repairs };
}

export function validatePostCandidateOutput(
  raw: unknown,
  assetById: Map<string, CandidateSourceAsset>,
  enabledPostTypes?: Set<string>,
  assetByDriveId?: Map<string, CandidateSourceAsset>,
): { ok: true; data: ValidatedPostCandidate } | { ok: false; error: string } {
  const parsed = llmCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const c = parsed.data;
  if (enabledPostTypes && !enabledPostTypes.has(c.post_type)) {
    return { ok: false, error: `disabled post_type ${c.post_type}` };
  }
  const title = c.title?.trim();
  if (!title) {
    return { ok: false, error: 'empty title' };
  }
  if (!c.source_asset_ids.length) {
    return { ok: false, error: 'source_asset_ids empty' };
  }

  const driveLookup = assetByDriveId ?? new Map<string, CandidateSourceAsset>();
  const resolved = resolveSourceAssetIds(
    c.source_asset_ids,
    c.source_drive_file_ids,
    assetById,
    driveLookup,
  );
  if ('error' in resolved) {
    return { ok: false, error: resolved.error };
  }

  let driveIds = c.source_drive_file_ids;
  const mismatched =
    driveIds.length !== resolved.driveIds.length ||
    driveIds.some((id, i) => id !== resolved.driveIds[i]);
  if (mismatched) {
    driveIds = resolved.driveIds;
  }

  return {
    ok: true,
    data: {
      ...c,
      title,
      source_asset_ids: resolved.ids,
      source_drive_file_ids: driveIds,
    },
  };
}

export type PlannerParseResult = {
  candidates: ValidatedPostCandidate[];
  validationErrors: string[];
  rawReturnedCount: number;
  structuralError?: string;
};

export function parsePlannerResponse(
  obj: unknown,
  summaries: AssetSummaryForLLM[],
  enabledPostTypes?: string[] | Set<string>,
): PlannerParseResult {
  const loose = llmResponseLooseSchema.safeParse(obj);
  if (!loose.success) {
    return {
      candidates: [],
      validationErrors: [],
      rawReturnedCount: 0,
      structuralError: `Invalid planner response shape: ${loose.error.message}`,
    };
  }

  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const enabledSet = enabledPostTypes
    ? enabledPostTypes instanceof Set
      ? enabledPostTypes
      : new Set(enabledPostTypes)
    : undefined;
  const out: ValidatedPostCandidate[] = [];
  const errors: string[] = [];

  for (let i = 0; i < loose.data.candidates.length; i++) {
    const row = loose.data.candidates[i];
    const v = validatePostCandidateOutput(row, assetById, enabledSet, assetByDriveId);
    if (!v.ok) {
      if (v.error.startsWith('disabled post_type')) {
        console.warn(`[skip disabled lane]\t${v.error}`);
      }
      errors.push(`candidate[${i}]: ${v.error}`);
      continue;
    }
    out.push(v.data);
  }

  return {
    candidates: out,
    validationErrors: errors,
    rawReturnedCount: loose.data.candidates.length,
  };
}

async function loadEnabledPostTypes(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('pipeline_settings')
    .select('enabled_post_types')
    .eq('singleton', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const allowed = new Set<string>(ALL_POST_TYPES);
  const raw = data?.enabled_post_types;
  if (!Array.isArray(raw)) return allowed;
  const enabled = new Set<string>();
  for (const v of raw) {
    if (typeof v === 'string' && allowed.has(v)) enabled.add(v);
  }
  return enabled.size > 0 ? enabled : allowed;
}

function extractTitleOverlayFromValidated(c: ValidatedPostCandidate): string | null {
  const reel = c.reel_instructions;
  if (reel != null && typeof reel === 'object' && !Array.isArray(reel)) {
    const t = (reel as Record<string, unknown>).thumbnail_text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  const st = c.static_post_instructions;
  if (st != null && typeof st === 'object' && !Array.isArray(st)) {
    const t = (st as Record<string, unknown>).main_text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

async function loadPlannerStableInstruction(supabase: SupabaseClient | null): Promise<{
  stableSystemInstruction: string;
  activeSeries: SeriesRow[];
  composed: Awaited<ReturnType<typeof loadComposedStableSystemInstruction>>;
}> {
  const composed = await loadComposedStableSystemInstruction(supabase, 'task_generate_candidate');
  const withSeries = await loadComposedSystemInstructionWithSeries(supabase, composed.text);
  return {
    stableSystemInstruction: withSeries.instruction,
    activeSeries: withSeries.activeSeries,
    composed,
  };
}

type PlannerCallParams = {
  ai: ReturnType<typeof createGeminiClient>;
  supabase: SupabaseClient | null;
  route: Awaited<ReturnType<typeof getResolvedModelRoute>>;
  promptVersion: string;
  stableSystemInstruction: string;
  dynamicText: string;
  summaries: AssetSummaryForLLM[];
  enabledPostTypes: string[];
};

async function runSinglePlannerCall(params: PlannerCallParams): Promise<{
  candidates: ValidatedPostCandidate[];
  llmRaw: Record<string, unknown>;
  model: string;
  rawReturnedCount: number;
  validationErrors: string[];
}> {
  const plannerCall = {
    ai: params.ai,
    supabase: params.supabase,
    route: params.route,
    promptVersion: params.promptVersion,
    cacheKey: cacheKeyCandidateGeneration(params.promptVersion, params.stableSystemInstruction),
    stableSystemInstruction: params.stableSystemInstruction,
    entity: {
      prompt_keys: [...STABLE_CONTEXT_KEYS, 'task_generate_candidate'],
      pipeline_step: 'candidate_generation',
    },
    getContentsImplicit: () => [
      createPartFromText(params.stableSystemInstruction),
      createPartFromText(params.dynamicText),
    ],
    getContentsExplicit: () => [createPartFromText(params.dynamicText)],
  };

  const maxAttempts = 2;
  let plannerResult: {
    response: Awaited<ReturnType<typeof callGeminiWithLogging>>['response'];
    modelUsed: string;
    text: string;
    obj: Record<string, unknown>;
  } | null = null;
  let out: ValidatedPostCandidate[] = [];
  let errors: string[] = [];
  let rawReturnedCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[planner] LLM attempt ${attempt}/${maxAttempts}`);
    const { response, modelUsed } = await callGeminiWithLogging(plannerCall);
    const text = response.text?.trim() ?? '';
    if (!text) {
      if (attempt < maxAttempts) {
        console.warn('[warn] planner returned empty text; retrying...');
        continue;
      }
      throw new Error('Gemini returned empty text');
    }

    let obj: Record<string, unknown>;
    try {
      obj = parseGeminiJsonObject(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < maxAttempts) {
        console.warn(`[warn] planner JSON parse failed (attempt ${attempt}): ${msg}; retrying...`);
        continue;
      }
      throw e;
    }

    const parsed = parsePlannerResponse(obj, params.summaries, params.enabledPostTypes);
    if (parsed.structuralError) {
      if (attempt < maxAttempts) {
        console.warn(`[warn] ${parsed.structuralError}; retrying...`);
        continue;
      }
      throw new Error(parsed.structuralError);
    }

    if (parsed.candidates.length === 0 && parsed.validationErrors.length > 0) {
      if (attempt < maxAttempts) {
        console.warn(
          `[warn] planner returned no valid candidates (${parsed.validationErrors.length} validation errors); retrying...`,
        );
        continue;
      }
    }

    plannerResult = { response, modelUsed, text, obj };
    out = parsed.candidates;
    errors = parsed.validationErrors;
    rawReturnedCount = parsed.rawReturnedCount;
    break;
  }

  if (!plannerResult) {
    throw new Error('Gemini returned no parseable planner response');
  }

  const { response, modelUsed, text } = plannerResult;
  const llmRaw: Record<string, unknown> = {
    ...responseToJson(response),
    text,
    validation_errors: errors.length ? errors : undefined,
  };

  return {
    candidates: out,
    llmRaw,
    model: modelUsed,
    rawReturnedCount,
    validationErrors: errors,
  };
}

async function runPlannerForTarget(params: {
  ai: ReturnType<typeof createGeminiClient>;
  supabase: SupabaseClient | null;
  route: Awaited<ReturnType<typeof getResolvedModelRoute>>;
  promptVersion: string;
  stableSystemInstruction: string;
  assets: AssetSummaryForLLM[];
  seriesSlug: string;
  postTypeHint: string;
  batchDays: number;
  enabledPostTypes: string[];
  avoidRecentRejections?: RejectedFeedbackItem[];
  committedRecentPosts?: ReturnType<typeof toCommittedPostForPrompt>[];
}): Promise<{
  candidates: ValidatedPostCandidateWithRaw[];
  validationErrors: string[];
  rawReturnedCount: number;
  model: string;
}> {
  const dynamicText = buildPostPlannerDynamicText({
    summaries: params.assets as unknown[],
    dailyTarget: 1,
    batchDays: params.batchDays,
    enabledPostTypes: params.enabledPostTypes,
    forceSeriesSlug: params.seriesSlug,
    postTypeHint: params.postTypeHint,
    avoidRecentRejections: params.avoidRecentRejections,
    committedRecentPosts: params.committedRecentPosts,
  });

  console.log(
    `[planner] target series=${params.seriesSlug} type=${params.postTypeHint} assets=${params.assets.length} dynamic_chars=${dynamicText.length}`,
  );

  const result = await runSinglePlannerCall({
    ai: params.ai,
    supabase: params.supabase,
    route: params.route,
    promptVersion: params.promptVersion,
    stableSystemInstruction: params.stableSystemInstruction,
    dynamicText,
    summaries: params.assets,
    enabledPostTypes: params.enabledPostTypes,
  });

  const withRaw: ValidatedPostCandidateWithRaw[] = result.candidates.map((c) => ({
    ...c,
    _llmRaw: result.llmRaw,
  }));

  return {
    candidates: withRaw,
    validationErrors: result.validationErrors,
    rawReturnedCount: result.rawReturnedCount,
    model: result.model,
  };
}

export async function generatePostCandidatesWithLLM(params: {
  summaries: AssetSummaryForLLM[];
  dailyTarget: number;
  topPairs?: number;
  batchDays: number;
  enabledPostTypes: string[];
  supabase: SupabaseClient | null;
  avoidRecentRejections?: RejectedFeedbackItem[];
  committedRecentPosts?: ReturnType<typeof toCommittedPostForPrompt>[];
}): Promise<{
  candidates: ValidatedPostCandidateWithRaw[];
  llmRaw: Record<string, unknown>;
  model: string;
  rawReturnedCount: number;
  validationErrors: string[];
  activeSeries: SeriesRow[];
}> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const ai = createGeminiClient(apiKey);
  const { stableSystemInstruction, activeSeries } = await loadPlannerStableInstruction(
    params.supabase,
  );
  const promptVersion = getFr94PromptVersion();
  const route = await getResolvedModelRoute(params.supabase, 'candidate_generation');
  const topPairs = params.topPairs ?? plannerTopPairs();

  console.log(
    `[planner] model=${route.model} assets=${params.summaries.length} llm_target=${params.dailyTarget} ` +
      `top_pairs=${topPairs} active_series=${activeSeries.length} stable_chars=${stableSystemInstruction.length} ` +
      `prompt_version=${promptVersion}`,
  );
  if (activeSeries.length > 0) {
    console.log(
      `[planner] series: ${activeSeries.map((s) => `${s.slug}(w=${s.weight})`).join(', ')}`,
    );
  } else {
    console.warn('[planner] no active content_series rows — generation will run without series bias');
  }

  const useTargetMode = activeSeries.length > 0;

  if (!useTargetMode) {
    console.log('[planner] mode=single (no active series)');
    const dynamicText = buildPostPlannerDynamicText({
      summaries: params.summaries as unknown[],
      dailyTarget: params.dailyTarget,
      batchDays: params.batchDays,
      enabledPostTypes: params.enabledPostTypes,
      avoidRecentRejections: params.avoidRecentRejections,
      committedRecentPosts: params.committedRecentPosts,
    });
    if (dynamicText.length > 40_000) {
      console.warn(
        `[planner] large dynamic payload (${dynamicText.length} chars, ${params.summaries.length} assets) — ` +
          'reduce POST_CANDIDATE_PLANNER_MAX_ASSETS or POST_CANDIDATE_LLM_TARGET if timeouts persist',
      );
    }
    const result = await runSinglePlannerCall({
      ai,
      supabase: params.supabase,
      route,
      promptVersion,
      stableSystemInstruction,
      dynamicText,
      summaries: params.summaries,
      enabledPostTypes: params.enabledPostTypes,
    });
    return {
      candidates: result.candidates,
      llmRaw: { mode: 'single', ...result.llmRaw },
      model: result.model,
      rawReturnedCount: result.rawReturnedCount,
      validationErrors: result.validationErrors,
      activeSeries,
    };
  }

  let selectedTargets: ScoredTarget[] = [];
  let targetsPlannedCount = 0;
  const bundleOpts = {
    carouselMax: plannerCarouselMaxAssets(),
    storyMax: plannerStoryMaxAssets(),
  };

  try {
    const fitAssets = params.summaries.map(toFitScoringAsset);
    const assetsById = new Map(fitAssets.map((a) => [a.id, a]));
    const planned = await planGenerationTargetsWithLLM({
      ai,
      supabase: params.supabase,
      promptVersion,
      assets: fitAssets,
      series: activeSeries,
      enabledPostTypes: params.enabledPostTypes,
    });
    targetsPlannedCount = planned.length;
    selectedTargets = selectTopTargets(
      planned,
      activeSeries,
      assetsById,
      topPairs,
      bundleOpts,
    );
    console.log(
      `[planner] targets: planned=${targetsPlannedCount} selected=${selectedTargets.length} ` +
        selectedTargets
          .map(
            (t) =>
              `${t.seriesSlug}:${t.postTypeHint}[${t.assetIds.length}](fit=${t.fitScore})`,
          )
          .join(', '),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[planner] asset_series_targets failed (${msg}); falling back to single call`);
  }

  if (selectedTargets.length === 0) {
    console.log('[planner] mode=single (target planning yielded no targets)');
    const dynamicText = buildPostPlannerDynamicText({
      summaries: params.summaries as unknown[],
      dailyTarget: params.dailyTarget,
      batchDays: params.batchDays,
      enabledPostTypes: params.enabledPostTypes,
      avoidRecentRejections: params.avoidRecentRejections,
      committedRecentPosts: params.committedRecentPosts,
    });
    const result = await runSinglePlannerCall({
      ai,
      supabase: params.supabase,
      route,
      promptVersion,
      stableSystemInstruction,
      dynamicText,
      summaries: params.summaries,
      enabledPostTypes: params.enabledPostTypes,
    });
    return {
      candidates: result.candidates,
      llmRaw: { mode: 'single_fallback', targets_planned: targetsPlannedCount, ...result.llmRaw },
      model: result.model,
      rawReturnedCount: result.rawReturnedCount,
      validationErrors: result.validationErrors,
      activeSeries,
    };
  }

  console.log(`[planner] mode=targets (${selectedTargets.length} parallel generation calls)`);
  const assetById = new Map(params.summaries.map((a) => [a.id, a]));

  const targetResults = await Promise.all(
    selectedTargets.map(async (target) => {
      const assets = target.assetIds
        .map((id) => assetById.get(id))
        .filter((a): a is AssetSummaryForLLM => a != null);
      if (assets.length === 0) {
        return {
          target,
          candidates: [] as ValidatedPostCandidateWithRaw[],
          validationErrors: [`missing assets for target ${target.seriesSlug}`],
          rawReturnedCount: 0,
          model: route.model,
          raw: null as Record<string, unknown> | null,
        };
      }
      try {
        const result = await runPlannerForTarget({
          ai,
          supabase: params.supabase,
          route,
          promptVersion,
          stableSystemInstruction,
          assets,
          seriesSlug: target.seriesSlug,
          postTypeHint: target.postTypeHint,
          batchDays: params.batchDays,
          enabledPostTypes: params.enabledPostTypes,
          avoidRecentRejections: params.avoidRecentRejections,
          committedRecentPosts: params.committedRecentPosts,
        });
        return {
          target,
          candidates: result.candidates,
          validationErrors: result.validationErrors,
          rawReturnedCount: result.rawReturnedCount,
          model: result.model,
          raw: result.candidates[0]?._llmRaw ?? null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[planner] target failed series=${target.seriesSlug} type=${target.postTypeHint}: ${msg}`,
        );
        return {
          target,
          candidates: [] as ValidatedPostCandidateWithRaw[],
          validationErrors: [
            `target ${target.seriesSlug}/${target.postTypeHint}: ${msg}`,
          ],
          rawReturnedCount: 0,
          model: route.model,
          raw: null,
        };
      }
    }),
  );

  const allCandidates: ValidatedPostCandidateWithRaw[] = [];
  const allErrors: string[] = [];
  let rawReturnedCount = 0;
  const generationRaws: Array<{
    series_slug: string;
    post_type_hint: string;
    asset_ids: string[];
    raw: Record<string, unknown> | null;
  }> = [];

  for (const tr of targetResults) {
    allCandidates.push(...tr.candidates);
    allErrors.push(...tr.validationErrors);
    rawReturnedCount += tr.rawReturnedCount;
    generationRaws.push({
      series_slug: tr.target.seriesSlug,
      post_type_hint: tr.target.postTypeHint,
      asset_ids: tr.target.assetIds,
      raw: tr.raw,
    });
  }

  const modelsUsed = [...new Set(targetResults.map((r) => r.model))];
  const llmRaw: Record<string, unknown> = {
    mode: 'targets',
    targets: selectedTargets,
    targets_planned: targetsPlannedCount,
    generation: generationRaws,
    validation_errors: allErrors.length ? allErrors : undefined,
  };

  return {
    candidates: allCandidates,
    llmRaw,
    model: modelsUsed.join(','),
    rawReturnedCount,
    validationErrors: allErrors,
    activeSeries,
  };
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export async function createReviewDriveFolder(
  drive: drive_v3.Drive,
  params: { parentFolderId: string; folderName: string },
): Promise<{ id: string; name: string; webViewLink: string | null }> {
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: params.folderName,
      mimeType: FOLDER_MIME,
      parents: [params.parentFolderId],
    },
    fields: 'id, name, webViewLink',
  });
  const id = res.data.id;
  const name = res.data.name ?? params.folderName;
  if (!id) {
    throw new Error('Drive folder create returned no id');
  }
  return {
    id,
    name,
    webViewLink: res.data.webViewLink ?? null,
  };
}

export async function copyAssetsToReviewFolder(
  drive: drive_v3.Drive,
  params: { driveFileIds: string[]; destFolderId: string },
): Promise<{ copied: number; failures: Array<{ drive_file_id: string; message: string }> }> {
  const failures: Array<{ drive_file_id: string; message: string }> = [];
  let copied = 0;

  for (const fileId of params.driveFileIds) {
    try {
      const meta = await drive.files.get({
        fileId,
        fields: 'name',
        supportsAllDrives: true,
      });
      const name = meta.data.name;
      if (!name?.trim()) {
        failures.push({ drive_file_id: fileId, message: 'Drive file has no name' });
        continue;
      }

      await drive.files.copy({
        fileId,
        supportsAllDrives: true,
        requestBody: {
          name,
          parents: [params.destFolderId],
        },
      });
      copied += 1;
    } catch (e) {
      failures.push({
        drive_file_id: fileId,
        message: formatGoogleDriveApiError(e),
      });
    }
  }

  return { copied, failures };
}

export async function insertPostCandidate(
  supabase: SupabaseClient,
  params: {
    id: string;
    candidateDate: string;
    c: ValidatedPostCandidate;
    llmModel: string;
    llmRaw: Record<string, unknown>;
  },
): Promise<{ error: string | null }> {
  const sf = storyFramesValue(params.c.story_frames);
  const reel = jsonObjectValue(params.c.reel_instructions);
  const slides = storyFramesValue(params.c.carousel_slides);
  const staticInst = jsonObjectValue(params.c.static_post_instructions);

  const row = {
    id: params.id,
    candidate_date: params.candidateDate,
    platform: 'instagram',
    post_type: params.c.post_type,
    title: params.c.title.trim(),
    hook: params.c.hook?.trim() || null,
    concept_summary: params.c.concept_summary?.trim() || null,
    rationale: params.c.rationale?.trim() || null,
    caption_fr: params.c.caption_fr,
    caption_en: params.c.caption_en?.trim() ? params.c.caption_en.trim() : null,
    hashtags: params.c.hashtags,
    story_frames: sf ?? [],
    reel_instructions: reel ?? {},
    carousel_slides: slides ?? [],
    static_post_instructions: staticInst ?? {},
    source_asset_ids: params.c.source_asset_ids,
    source_drive_file_ids: params.c.source_drive_file_ids,
    priority_score: params.c.priority_score,
    mission_score: params.c.mission_score,
    human_score: params.c.human_score,
    sponsor_safety_score: params.c.sponsor_safety_score,
    effort_score: params.c.effort_score,
    status: 'needs_review',
    selected_series: params.c.selected_series?.trim() || null,
    narrative_function: params.c.narrative_function?.trim() || null,
    title_overlay: extractTitleOverlayFromValidated(params.c),
    llm_model: params.llmModel,
    llm_raw: params.llmRaw,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('post_candidates').insert(row);
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

export async function updatePostCandidateReviewFolder(
  supabase: SupabaseClient,
  params: {
    id: string;
    review_drive_folder_id: string;
    review_drive_folder_name: string;
    review_drive_folder_url: string;
    cover_thumbnail_url?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('post_candidates')
    .update({
      review_drive_folder_id: params.review_drive_folder_id,
      review_drive_folder_name: params.review_drive_folder_name,
      review_drive_folder_url: params.review_drive_folder_url,
      ...(params.cover_thumbnail_url !== undefined
        ? { cover_thumbnail_url: params.cover_thumbnail_url }
        : {}),
      updated_at: now,
    })
    .eq('id', params.id);

  if (error) throw error;
}

export async function generatePostCandidates(): Promise<void> {
  const batchDays = envInt('POST_CANDIDATE_BATCH_DAYS', 14);
  const maxAssets = envInt('POST_CANDIDATE_MAX_ASSETS', 80);
  const llmTarget = plannerLlmTarget();
  const plannerCap = plannerMaxAssets();
  const topPairs = plannerTopPairs();
  const reviewParentId = requireEnv('GOOGLE_DRIVE_READY_FOR_REVIEW_FOLDER_ID');

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();
  const enabledPostTypes = [...(await loadEnabledPostTypes(supabase))];

  const assets = await getCandidateSourceAssets(supabase, { maxAssets });
  console.log(`source assets (processed, relaxed pool, max ${maxAssets}, batch hint ${batchDays}d): ${assets.length}`);

  const recentLedger = await loadRecentLedgerContext(supabase);
  const committedRecentPosts = recentLedger.map(toCommittedPostForPrompt);
  console.log(`content ledger: ${committedRecentPosts.length} committed posts in context`);

  // --- Clip-based reel path (inverted model): retrieval + assembly from content_clips ---
  let clipReelActive = false;
  let reelInserted = 0;
  if (enabledPostTypes.includes('reel')) {
    try {
      const probe = await loadReadyClipsForReels(supabase, { limit: 1 });
      clipReelActive = probe.length > 0;
    } catch (e) {
      console.warn('[reel-clips] probe failed; falling back to legacy reel planning', e);
    }
  }

  if (clipReelActive) {
    const autoReelRenderEnabled = await loadAutoReelRenderEnabled(supabase);
    try {
      const reelRecent = recentLedger
        .filter((r) => r.post_type === 'reel')
        .map(toCommittedPostForPrompt);
      const ai = createGeminiClient(requireEnv('GEMINI_API_KEY'));
      const res = await assembleReelFromClips({ supabase, ai, recentCommitted: reelRecent });

      if (!res.ok) {
        console.log(`[reel-clips] skipped: ${res.skipped}`);
      } else {
        const ins = await insertReelCandidate(supabase, {
          reel: res.reel,
          candidateDate: utcDateString(),
        });
        if (ins.error) {
          console.warn(`[reel-clips] insert failed: ${ins.error}`);
        } else {
          reelInserted += 1;
          console.log(
            `[reel-clips] candidate=${ins.id} series=${res.reel.selected_series} clips=${res.reel.selected_clip_ids.length} duration=${res.reel.spec.total_duration_sec}s hook="${res.reel.hook}"`,
          );

          for (const aid of res.reel.source_asset_ids) {
            try {
              await recordAssetUsageEvent(supabase, {
                contentAssetId: aid,
                postCandidateId: ins.id,
                publishingJobId: null,
                usageStage: 'suggested',
                usageType: mapPostTypeToUsageType('reel'),
                ledgerPostType: 'reel',
                usageRole: 'primary',
                lockStrength: 'soft',
                notes: 'Included in clip-based reel candidate',
              });
              await updateAssetUsageSummary(supabase, aid);
            } catch (e) {
              console.warn(`[reel-clips usage event]\tasset=${aid}\tcandidate=${ins.id}`, e);
            }
          }

          try {
            await refreshCandidateAssetConflicts(supabase, ins.id);
          } catch (e) {
            console.warn(`[reel-clips asset conflicts]\t${ins.id}`, e);
          }

          try {
            const collision = await evaluateCandidateCollision(supabase, ins.id, recentLedger);
            console.log(`[reel-clips collision]\trisk=${collision.risk}`);
          } catch (e) {
            console.warn(`[reel-clips collision check]\t${ins.id}`, e);
          }

          if (autoReelRenderEnabled) {
            const renderRes = await enqueueReelRenderJob(supabase, {
              candidateId: ins.id,
              reel: res.reel,
            });
            if (renderRes.error) {
              console.warn(`[reel-clips] render enqueue failed: ${renderRes.error}`);
            } else {
              console.log(`[reel-clips] render job queued for ${ins.id}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[reel-clips] generation failed (non-fatal)', e);
    }
  }

  // Legacy planner keeps non-reel types; reels stay legacy only while no clips exist.
  const plannerPostTypes = clipReelActive
    ? enabledPostTypes.filter((t) => t !== 'reel')
    : enabledPostTypes;

  if (assets.length === 0) {
    console.log(`summary: no assets to plan; reel_clip_candidates=${reelInserted}`);
    return;
  }
  if (plannerPostTypes.length === 0) {
    console.log(`summary: no planner post types enabled; reel_clip_candidates=${reelInserted}`);
    return;
  }

  const rejectedRows = await fetchRecentRejectedCandidates(supabase);
  const avoidRecentRejections = buildRejectedFeedbackForPrompt(rejectedRows);
  const rejectedIndex = buildRejectedIndex(rejectedRows);
  console.log(`rejected feedback: ${avoidRecentRejections.length} recent rejections loaded`);

  const allSummaries = assets.map((a) => buildAssetSummaryForLLM(a));
  const committedAssetIds = new Set(
    committedRecentPosts
      .map((p) => p.primary_asset_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const rejectedAssetIds = new Set(rejectedRows.flatMap((r) => r.source_asset_ids));
  const ranked = rankAndCapPlannerAssets(
    allSummaries,
    { committedAssetIds, rejectedAssetIds },
    plannerCap,
  );
  console.log(
    `planner assets: pool=${ranked.totalPool} eligible=${ranked.eligibleCount} sent_to_llm=${ranked.selected.length} (cap=${plannerCap})`,
  );

  if (ranked.selected.length === 0) {
    console.log('summary: no eligible assets for planner after ranking; exiting');
    return;
  }

  let llmResult: Awaited<ReturnType<typeof generatePostCandidatesWithLLM>>;
  try {
    llmResult = await generatePostCandidatesWithLLM({
      summaries: ranked.selected,
      dailyTarget: llmTarget,
      topPairs,
      batchDays,
      enabledPostTypes: plannerPostTypes,
      supabase,
      avoidRecentRejections,
      committedRecentPosts,
    });
  } catch (e) {
    const msg = formatGeminiFetchError(e);
    console.error(`LLM planner failed: ${msg}`);
    console.error(
      '[planner] hint: transient timeouts may clear on retry; set FR94_GEMINI_HTTP_TIMEOUT_MS (default 600000) if needed',
    );
    throw e;
  }

  const candidateDate = utcDateString();
  const existingTitles = await fetchExistingTitlesForDate(supabase, candidateDate);

  let inserted = 0;
  let foldersCreated = 0;
  let assetsCopied = 0;
  let skippedDedupe = 0;
  let skippedRejected = 0;
  let collisionBlocked = 0;
  let insertFailures = 0;
  let driveSetupFailures = 0;
  let copyFailures = 0;

  console.log(
    `LLM candidates: raw=${llmResult.rawReturnedCount}\tvalidated=${llmResult.candidates.length}` +
      (llmResult.validationErrors.length ? `\tvalidation_notes=${llmResult.validationErrors.length}` : ''),
  );

  for (const c of llmResult.candidates) {
    const dedupeKey = normalizeDedupeTitle(c.title);
    if (existingTitles.has(dedupeKey)) {
      console.warn(`[skip dedupe]\t"${c.title}"\t(${candidateDate})`);
      skippedDedupe += 1;
      continue;
    }

    const rejectedReason = getRejectedSkipReason(c, rejectedIndex);
    if (rejectedReason) {
      console.warn(`[skip rejected]\t"${c.title}"\t${rejectedReason}`);
      skippedRejected += 1;
      continue;
    }

    const id = randomUUID();
    const shortId = id.replace(/-/g, '').slice(0, 6);
    const typeSlug = sanitizeFilenamePart(c.post_type, 20);
    const titleSlug = sanitizeFilenamePart(c.title, 48);
    const folderName = `${candidateDate}_${typeSlug}_${titleSlug}_${shortId}`;

    const insertRes = await insertPostCandidate(supabase, {
      id,
      candidateDate,
      c: (() => {
        const { _llmRaw: _, ...rest } = c;
        return rest;
      })(),
      llmModel: llmResult.model,
      llmRaw: c._llmRaw ?? llmResult.llmRaw,
    });

    if (insertRes.error) {
      console.warn(`[insert failed]\t${c.title}\t${insertRes.error}`);
      insertFailures += 1;
      continue;
    }

    existingTitles.add(dedupeKey);
    inserted += 1;

    const usageType = mapPostTypeToUsageType(c.post_type);
    for (const aid of c.source_asset_ids) {
      try {
        await recordAssetUsageEvent(supabase, {
          contentAssetId: aid,
          postCandidateId: id,
          publishingJobId: null,
          usageStage: 'suggested',
          usageType,
          ledgerPostType: c.post_type,
          usageRole: 'primary',
          lockStrength: 'soft',
          notes: 'Included in generated post candidate',
        });
        await updateAssetUsageSummary(supabase, aid);
      } catch (e) {
        console.warn(`[suggested usage event]\tasset=${aid}\tcandidate=${id}`, e);
      }
    }

    try {
      await refreshCandidateAssetConflicts(supabase, id);
    } catch (e) {
      console.warn(`[candidate asset conflicts]\t${id}`, e);
    }

    try {
      const collision = await evaluateCandidateCollision(supabase, id, recentLedger);
      console.log(`[collision]\t${c.title}\trisk=${collision.risk}`);
      if (collision.risk === 'blocked') collisionBlocked += 1;
    } catch (e) {
      console.warn(`[collision check]\t${id}`, e);
    }

    try {
      const folder = await createReviewDriveFolder(drive, {
        parentFolderId: reviewParentId,
        folderName,
      });
      foldersCreated += 1;

      const copyRes = await copyAssetsToReviewFolder(drive, {
        driveFileIds: c.source_drive_file_ids,
        destFolderId: folder.id,
      });
      assetsCopied += copyRes.copied;
      copyFailures += copyRes.failures.length;
      for (const f of copyRes.failures) {
        console.warn(`[copy failed]\t${f.drive_file_id}\t${f.message}`);
      }

      const folderUrl = folder.webViewLink ?? driveFolderUrl(folder.id);
      let coverThumbnailUrl: string | null = null;
      try {
        coverThumbnailUrl = await getFirstReviewFolderThumbnailLink(drive, folder.id, {
          fallbackDriveFileIds: c.source_drive_file_ids,
        });
      } catch (e) {
        console.warn(`[cover thumbnail]\tpost_candidate=${id}`, e);
      }

      await updatePostCandidateReviewFolder(supabase, {
        id,
        review_drive_folder_id: folder.id,
        review_drive_folder_name: folder.name,
        review_drive_folder_url: folderUrl,
        cover_thumbnail_url: coverThumbnailUrl,
      });
    } catch (e) {
      const msg = formatGoogleDriveApiError(e);
      console.warn(`[drive failed]\tpost_candidate=${id}\t(row inserted; no review folder)\t${msg}`);
      driveSetupFailures += 1;
    }
  }

  console.log(
    [
      'summary:',
      `assets_sent=${ranked.selected.length}`,
      `candidates_valid=${llmResult.candidates.length}`,
      `inserted=${inserted}`,
      `reel_clip_candidates=${reelInserted}`,
      `folders_created=${foldersCreated}`,
      `assets_copied=${assetsCopied}`,
      `skipped_dedupe=${skippedDedupe}`,
      `skipped_rejected=${skippedRejected}`,
      `collision_blocked=${collisionBlocked}`,
      `insert_failures=${insertFailures}`,
      `drive_setup_failures=${driveSetupFailures}`,
      `drive_copy_failures=${copyFailures}`,
    ].join(' '),
  );
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  generatePostCandidates().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
