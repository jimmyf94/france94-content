import { GoogleGenAI, createPartFromText } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  callGeminiWithLogging,
  getResolvedModelRoute,
  loadResolvedStablePrompt,
  responseToJson,
} from '@fr94/ai/gemini-client.js';
import { cacheKeyCandidateRegeneration, getFr94PromptVersion } from '@fr94/ai/prompt-version.js';
import { buildCandidateRegenerationDynamicPayload } from '@fr94/ai/prompts/candidate-regeneration.js';

const postTypeEnum = z.enum([
  'reel',
  'story_sequence',
  'carousel',
  'static_post',
  'sponsor_post',
  'archive_note',
]);

// Single-candidate rewrite output. Server preserves source_asset_ids and
// source_drive_file_ids, so the LLM is not allowed to redefine them.
const rewriteOutputSchema = z.object({
  post_type: postTypeEnum,
  title: z.string(),
  hook: z.string().optional(),
  concept_summary: z.string().optional(),
  rationale: z.string().optional(),
  caption_fr: z.string(),
  caption_en: z.string().optional(),
  hashtags: z.array(z.string()),
  priority_score: z.number().min(0).max(10).optional().default(5),
  mission_score: z.number().min(0).max(10).optional().default(5),
  human_score: z.number().min(0).max(10).optional().default(5),
  sponsor_safety_score: z.number().min(0).max(10).optional().default(5),
  effort_score: z.number().min(0).max(10).optional().default(5),
  story_frames: z.any().optional(),
  reel_instructions: z.any().optional(),
  carousel_slides: z.any().optional(),
  static_post_instructions: z.any().optional(),
});

export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;

export type RegenerateInputCandidate = {
  id: string;
  post_type: string | null;
  title: string | null;
  hook: string | null;
  concept_summary: string | null;
  rationale: string | null;
  caption_fr: string | null;
  caption_en: string | null;
  hashtags: string[] | null;
  story_frames: unknown;
  reel_instructions: unknown;
  carousel_slides: unknown;
  static_post_instructions: unknown;
  priority_score: number | null;
  mission_score: number | null;
  human_score: number | null;
  sponsor_safety_score: number | null;
  effort_score: number | null;
};

export type ContentAssetRow = {
  id: string;
  drive_file_id: string | null;
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
  geo_label: string | null;
  geo_locality: string | null;
  postal_code: string | null;
  duration_seconds: number | string | null;
  drive_web_view_link: string | null;
};

export const CONTENT_ASSET_COLUMNS_FOR_REWRITE = [
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
  'geo_label',
  'geo_locality',
  'postal_code',
  'duration_seconds',
  'drive_web_view_link',
].join(', ');

export type AssetSummaryForRewrite = {
  id: string;
  drive_file_id: string | null;
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
};

function truncateText(s: string | null | undefined, max: number): string | null {
  if (s == null || !String(s).trim()) return null;
  const t = String(s).trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function buildAssetSummary(
  asset: ContentAssetRow,
  excerptLen = 400,
): AssetSummaryForRewrite {
  const location =
    asset.geo_locality?.trim() ||
    (asset.geo_label?.trim() ? (asset.geo_label.split(',')[0]?.trim() ?? null) : null) ||
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
  };
}

function stripCodeFences(text: string): string {
  let s = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im;
  const m = s.match(fence);
  if (m?.[1]) {
    s = m[1].trim();
  }
  return s;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseJsonToRecord(rawText: string): Record<string, unknown> {
  const trimmed = stripCodeFences(rawText.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const extracted = extractJsonObject(trimmed);
    if (!extracted) {
      throw new Error('Model output was not valid JSON (repair pass found no JSON object)');
    }
    parsed = JSON.parse(extracted);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Parsed JSON is not an object');
  }
  return parsed as Record<string, unknown>;
}

function buildCandidateJsonForLLM(c: RegenerateInputCandidate): Record<string, unknown> {
  return {
    post_type: c.post_type,
    title: c.title,
    hook: c.hook,
    concept_summary: c.concept_summary,
    rationale: c.rationale,
    caption_fr: c.caption_fr,
    caption_en: c.caption_en,
    hashtags: c.hashtags,
    story_frames: c.story_frames,
    reel_instructions: c.reel_instructions,
    carousel_slides: c.carousel_slides,
    static_post_instructions: c.static_post_instructions,
    priority_score: c.priority_score,
    mission_score: c.mission_score,
    human_score: c.human_score,
    sponsor_safety_score: c.sponsor_safety_score,
    effort_score: c.effort_score,
  };
}

/**
 * Replace any `asset_id` inside story_frames / carousel_slides that is not in
 * the current source_asset_ids set. Keeps validation simple per spec.
 */
export function stripStaleAssetRefs(
  rewritten: RewriteOutput,
  validAssetIds: string[],
): { rewritten: RewriteOutput; strippedCount: number } {
  const valid = new Set(validAssetIds);
  let strippedCount = 0;

  const cleanArray = (arr: unknown): unknown => {
    if (!Array.isArray(arr)) return arr;
    return arr.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const obj = item as Record<string, unknown>;
      const aid = obj.asset_id;
      if (typeof aid === 'string' && aid.length > 0 && !valid.has(aid)) {
        strippedCount += 1;
        return { ...obj, asset_id: '' };
      }
      return obj;
    });
  };

  return {
    rewritten: {
      ...rewritten,
      story_frames: cleanArray(rewritten.story_frames),
      carousel_slides: cleanArray(rewritten.carousel_slides),
    },
    strippedCount,
  };
}

export type RegenerateLLMResult = {
  rewritten: RewriteOutput;
  llmRaw: Record<string, unknown>;
  model: string;
  strippedAssetRefs: number;
};

export async function regenerateCandidateWithLLM(params: {
  candidate: RegenerateInputCandidate;
  reviewerNotes: string;
  assetSummaries: AssetSummaryForRewrite[];
  validAssetIds: string[];
  supabase?: SupabaseClient | null;
}): Promise<RegenerateLLMResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing required environment variable: GEMINI_API_KEY');
  }
  const route = await getResolvedModelRoute(params.supabase ?? null, 'candidate_regeneration');

  const stable = (await loadResolvedStablePrompt(params.supabase ?? null, 'candidate_regeneration')).text;
  const reviewerNotes = params.reviewerNotes.trim() || '(no explicit reviewer notes)';
  const dynamicText = buildCandidateRegenerationDynamicPayload({
    reviewerNotes,
    candidate: buildCandidateJsonForLLM(params.candidate),
    assetSummaries: params.assetSummaries,
  });

  const ai = new GoogleGenAI({ apiKey });
  const promptVersion = getFr94PromptVersion();
  const { response, modelUsed } = await callGeminiWithLogging({
    ai,
    supabase: params.supabase ?? null,
    route,
    promptVersion,
    cacheKey: cacheKeyCandidateRegeneration(promptVersion, stable),
    stableSystemInstruction: stable,
    getContentsImplicit: () => [
      createPartFromText(stable),
      createPartFromText(dynamicText),
    ],
    getContentsExplicit: () => [createPartFromText(dynamicText)],
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned empty text');
  }

  const obj = parseJsonToRecord(text);
  const validated = rewriteOutputSchema.safeParse(obj);
  if (!validated.success) {
    throw new Error(`Invalid rewrite response schema: ${validated.error.message}`);
  }

  const stripped = stripStaleAssetRefs(validated.data, params.validAssetIds);

  const llmRaw: Record<string, unknown> = {
    ...responseToJson(response),
    text,
    rewrite: true,
    stripped_asset_refs: stripped.strippedCount || undefined,
  };

  return {
    rewritten: stripped.rewritten,
    llmRaw,
    model: modelUsed,
    strippedAssetRefs: stripped.strippedCount,
  };
}
