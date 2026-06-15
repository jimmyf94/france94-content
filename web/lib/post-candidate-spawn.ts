import { randomUUID } from 'node:crypto';

import { createPartFromText } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  callGeminiWithLogging,
  createGeminiClient,
  getResolvedModelRoute,
  loadComposedStableSystemInstruction,
  responseToJson,
  STABLE_CONTEXT_KEYS,
} from '@fr94/ai/gemini-client.js';
import { cacheKeyCandidateRegeneration, getFr94PromptVersion } from '@fr94/ai/prompt-version.js';
import { parseGeminiJsonObject } from '@fr94/ai/parse-gemini-json.js';
import {
  buildCandidateSpawnDynamicPayload,
  type CandidateSpawnMode,
  type SourceStructureContract,
} from '@fr94/ai/prompts/candidate-spawn.js';
import { loadComposedSystemInstructionWithSeries } from '@fr94/content-series';
import {
  recordAssetUsageEvent,
  refreshCandidateAssetConflicts,
  updateAssetUsageSummary,
  mapPostTypeToUsageType,
} from '@fr94/asset-usage';
import { loadRecentLedgerContext } from '@fr94/content-ledger';
import { evaluateCandidateCollision } from '@fr94/candidate-collision';
import {
  copyAssetsToReviewFolder,
  createReviewDriveFolder,
  driveFolderUrl,
  getCandidateSourceAssets,
  insertPostCandidate,
  validatePostCandidateOutput,
  type CandidateSourceAsset,
  type ValidatedPostCandidate,
} from '@fr94/post-candidate-shared';
import { sanitizeFilenamePart } from '@fr94/filename-sanitize';
import { loadAutoReelRenderEnabled } from '@fr94/pipeline-settings';
import {
  assembleReelFromClips,
  buildVariantBaseFromCandidate,
  enqueueReelRenderJob,
  insertReelCandidate,
  pickAlternateSeriesSlug,
  type ReelVariantKind,
} from '@fr94/reel-assembly';
import { loadReadyClipsForReels } from '@fr94/content-clips';
import { loadActiveSeries } from '@fr94/content-series';
import { getDriveClient } from '@/lib/google-drive-server';
import { rankAndCapPlannerAssets } from '@fr94/planner-asset-ranking';

import {
  buildAssetSummary,
  stripStaleAssetRefs,
  type ContentAssetRow,
} from '@/lib/post-candidate-rewrite';

export const SPAWN_MODES = [
  'keep_text_change_assets',
  'shuffle_assets',
  'shuffle_assets_and_text',
] as const;

export type SpawnMode = (typeof SPAWN_MODES)[number];

export const SPAWN_ASSET_POOLS = ['same', 'planner_eligible'] as const;
export type SpawnAssetPool = (typeof SPAWN_ASSET_POOLS)[number];

const spawnBodySchema = z.object({
  mode: z.enum(SPAWN_MODES),
  asset_pool: z.enum(SPAWN_ASSET_POOLS).optional().default('planner_eligible'),
  operator_notes: z.string().optional().default(''),
});

export type SpawnRequest = z.infer<typeof spawnBodySchema>;

export function parseSpawnRequest(body: unknown): SpawnRequest {
  return spawnBodySchema.parse(body);
}

const ALLOWED_SOURCE_STATUSES = new Set([
  'posted',
  'produced',
  'approved',
  'ready_to_publish',
]);

const spawnOutputSchema = z.object({
  post_type: z.string(),
  title: z.string(),
  hook: z.string().optional(),
  concept_summary: z.string().optional(),
  rationale: z.string().optional(),
  caption_fr: z.string(),
  caption_en: z.string().optional(),
  hashtags: z.array(z.string()),
  source_asset_ids: z.array(z.string()),
  source_drive_file_ids: z.array(z.string()).optional().default([]),
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function isClipReelInstructions(reelInstructions: unknown): boolean {
  if (!reelInstructions || typeof reelInstructions !== 'object') return false;
  const spec = reelInstructions as Record<string, unknown>;
  return spec.version === 'clips-v1' && Array.isArray(spec.clips) && spec.clips.length > 0;
}

function unwrapSpawnCandidate(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Spawn response must be a JSON object');
  }

  if (Array.isArray(obj)) {
    if (obj.length === 1 && obj[0] && typeof obj[0] === 'object' && !Array.isArray(obj[0])) {
      return obj[0] as Record<string, unknown>;
    }
    throw new Error(
      `Spawn response must be one candidate object, not an array of ${obj.length} item(s)`,
    );
  }

  const rec = obj as Record<string, unknown>;
  if (typeof rec.post_type === 'string') {
    return rec;
  }

  const nested = rec.candidate;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }

  const candidates = rec.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return first as Record<string, unknown>;
    }
  }

  throw new Error(
    'Spawn response must be a single candidate object (or { candidates: [one] }). Got a wrapper without post_type.',
  );
}

function normalizeSpawnCandidateShape(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  if (typeof out.hashtags === 'string') {
    out.hashtags = out.hashtags
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
  }
  if (out.hashtags == null) {
    out.hashtags = [];
  }
  if (typeof out.caption_en !== 'string') {
    out.caption_en = out.caption_en == null ? '' : String(out.caption_en);
  }
  return out;
}

function buildSourceCandidateJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    post_type: row.post_type,
    title: row.title,
    hook: row.hook,
    concept_summary: row.concept_summary,
    rationale: row.rationale,
    caption_fr: row.caption_fr,
    caption_en: row.caption_en,
    hashtags: row.hashtags,
    story_frames: row.story_frames,
    reel_instructions: row.reel_instructions,
    carousel_slides: row.carousel_slides,
    static_post_instructions: row.static_post_instructions,
    priority_score: row.priority_score,
    mission_score: row.mission_score,
    human_score: row.human_score,
    sponsor_safety_score: row.sponsor_safety_score,
    effort_score: row.effort_score,
    selected_series: row.selected_series,
    narrative_function: row.narrative_function,
    source_asset_ids: row.source_asset_ids,
  };
}

function resolveSpawnRoot(row: Record<string, unknown>): string {
  const spawnRoot =
    typeof row.spawn_root_candidate_id === 'string' && row.spawn_root_candidate_id.trim()
      ? row.spawn_root_candidate_id.trim()
      : null;
  if (spawnRoot) return spawnRoot;
  const variantOf =
    typeof row.variant_of === 'string' && row.variant_of.trim() ? row.variant_of.trim() : null;
  if (variantOf) return variantOf;
  return String(row.id);
}

function reelVariantKindForMode(mode: SpawnMode): ReelVariantKind {
  if (mode === 'shuffle_assets') return 'different_clip_order';
  return 'different_clip_order';
}

function buildSourceStructureContract(source: Record<string, unknown>): SourceStructureContract {
  const sourceAssetIds = asStringArray(source.source_asset_ids);
  let clipCount: number | null = null;
  let durationSec: number | null = null;
  let slideCount: number | null = null;

  const reel = source.reel_instructions;
  if (isClipReelInstructions(reel)) {
    const spec = reel as { clips?: unknown[]; total_duration_sec?: number };
    clipCount = Array.isArray(spec.clips) ? spec.clips.length : 0;
    if (typeof spec.total_duration_sec === 'number') durationSec = spec.total_duration_sec;
  }

  const carousel = source.carousel_slides;
  const story = source.story_frames;
  if (Array.isArray(carousel) && carousel.length > 0) slideCount = carousel.length;
  else if (Array.isArray(story) && story.length > 0) slideCount = story.length;

  return {
    post_type: source.post_type,
    source_asset_count: sourceAssetIds.length,
    source_clip_count: clipCount,
    source_slide_count: slideCount,
    source_duration_sec: durationSec,
    preserve_asset_count: true,
    preserve_clip_count: clipCount != null && clipCount > 0,
    creative_anchors: {
      hook: source.hook,
      caption_fr: source.caption_fr,
      concept_summary: source.concept_summary,
      title: source.title,
      selected_series: source.selected_series,
    },
  };
}

function normalizeText(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: unknown): Set<string> {
  return new Set(
    normalizeText(text)
      .split(/\W+/)
      .filter((w) => w.length > 3),
  );
}

function textSimilarity(a: unknown, b: unknown): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

function textsMateriallySame(a: unknown, b: unknown): boolean {
  if (normalizeText(a) === normalizeText(b)) return true;
  return textSimilarity(a, b) >= 0.85;
}

function operatorAllowsStructureChange(notes: string): boolean {
  const n = notes.toLowerCase();
  return (
    n.includes('more clip') ||
    n.includes('fewer clip') ||
    n.includes('more slide') ||
    n.includes('fewer slide') ||
    n.includes('different length') ||
    n.includes('change structure')
  );
}

function extractOutputClipCount(validated: ValidatedPostCandidate): number | null {
  const reel = validated.reel_instructions;
  if (!isClipReelInstructions(reel)) return null;
  const spec = reel as { clips?: unknown[] };
  return Array.isArray(spec.clips) ? spec.clips.length : null;
}

function extractOutputSlideCount(validated: ValidatedPostCandidate): number {
  if (Array.isArray(validated.carousel_slides) && validated.carousel_slides.length > 0) {
    return validated.carousel_slides.length;
  }
  if (Array.isArray(validated.story_frames) && validated.story_frames.length > 0) {
    return validated.story_frames.length;
  }
  return 0;
}

function validateSpawnOutput(params: {
  mode: SpawnMode;
  source: Record<string, unknown>;
  validated: ValidatedPostCandidate;
  operatorNotes: string;
  structureContract: SourceStructureContract;
}): void {
  const { mode, source, validated, operatorNotes, structureContract } = params;
  const sourceAssetIds = new Set(asStringArray(source.source_asset_ids));
  const outAssetIds = validated.source_asset_ids;
  const allowStructureChange = operatorAllowsStructureChange(operatorNotes);

  if (!allowStructureChange && structureContract.preserve_asset_count) {
    if (outAssetIds.length !== structureContract.source_asset_count) {
      throw new Error(
        `Spawn validation: expected ${structureContract.source_asset_count} asset(s), got ${outAssetIds.length}. Add operator notes to allow a different structure.`,
      );
    }
  }

  if (structureContract.preserve_clip_count && structureContract.source_clip_count != null) {
    const outClipCount = extractOutputClipCount(validated);
    if (
      outClipCount != null &&
      !allowStructureChange &&
      outClipCount !== structureContract.source_clip_count
    ) {
      throw new Error(
        `Spawn validation: expected ${structureContract.source_clip_count} clip(s), got ${outClipCount}. Add operator notes to allow a different structure.`,
      );
    }
  }

  if (structureContract.source_slide_count != null && structureContract.source_slide_count > 0) {
    const outSlides = extractOutputSlideCount(validated);
    if (
      !allowStructureChange &&
      outSlides > 0 &&
      outSlides !== structureContract.source_slide_count
    ) {
      throw new Error(
        `Spawn validation: expected ${structureContract.source_slide_count} slide(s), got ${outSlides}.`,
      );
    }
  }

  const reused = outAssetIds.filter((id) => sourceAssetIds.has(id));
  if (
    (mode === 'keep_text_change_assets' || mode === 'shuffle_assets_and_text') &&
    reused.length > 0
  ) {
    throw new Error(
      `Spawn validation: output reused source asset(s): ${reused.join(', ')}. Need more alternative footage in the pool.`,
    );
  }

  if (mode === 'keep_text_change_assets') {
    if (!textsMateriallySame(source.hook, validated.hook)) {
      throw new Error('Spawn validation: keep_text_change_assets requires the hook to stay the same.');
    }
    if (!textsMateriallySame(source.caption_fr, validated.caption_fr)) {
      throw new Error(
        'Spawn validation: keep_text_change_assets requires caption_fr to stay the same.',
      );
    }
    const sameAssetSet =
      outAssetIds.length === sourceAssetIds.size &&
      outAssetIds.every((id) => sourceAssetIds.has(id));
    if (sameAssetSet) {
      throw new Error(
        'Spawn validation: keep_text_change_assets requires different assets than the source.',
      );
    }
  }

  if (mode === 'shuffle_assets') {
    if (!textsMateriallySame(source.hook, validated.hook)) {
      throw new Error('Spawn validation: shuffle_assets should preserve the hook.');
    }
    if (!textsMateriallySame(source.caption_fr, validated.caption_fr)) {
      throw new Error('Spawn validation: shuffle_assets should preserve caption_fr.');
    }
  }

  if (mode === 'shuffle_assets_and_text') {
    const anchorOverlap = Math.max(
      textSimilarity(structureContract.creative_anchors.hook, validated.hook),
      textSimilarity(structureContract.creative_anchors.caption_fr, validated.caption_fr),
      textSimilarity(structureContract.creative_anchors.concept_summary, validated.concept_summary),
    );
    if (anchorOverlap < 0.12) {
      throw new Error(
        'Spawn validation: refreshed text does not anchor to the source creative DNA (hook/caption/concept). Try adding operator notes.',
      );
    }
    if (
      textsMateriallySame(source.caption_fr, validated.caption_fr) &&
      textsMateriallySame(source.hook, validated.hook)
    ) {
      throw new Error(
        'Spawn validation: shuffle_assets_and_text requires refreshed wording, not identical text.',
      );
    }
  }
}

function mapPostTypeToUsageTypeLocal(postType: string): string {
  return mapPostTypeToUsageType(postType);
}

async function loadRecentLedger(supabase: SupabaseClient) {
  try {
    return await loadRecentLedgerContext(supabase);
  } catch {
    return [];
  }
}

async function resolveAssetPool(
  supabase: SupabaseClient,
  source: Record<string, unknown>,
  pool: SpawnAssetPool,
  mode: SpawnMode,
): Promise<CandidateSourceAsset[]> {
  const sourceIds = new Set(asStringArray(source.source_asset_ids));
  const excludeSource =
    pool === 'planner_eligible' &&
    (mode === 'keep_text_change_assets' || mode === 'shuffle_assets_and_text');

  if (pool === 'same') {
    if (sourceIds.size === 0) {
      throw new Error('Source candidate has no attached assets');
    }
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
      .in('id', [...sourceIds]);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as CandidateSourceAsset[];
    if (rows.length === 0) throw new Error('Attached source assets not found');
    return rows;
  }

  const maxAssets = 40;
  const all = await getCandidateSourceAssets(supabase, { maxAssets: maxAssets * 2 });
  const summaries = all.map((a) => ({
    ...a,
    is_fresh_for_story: false,
    usage_status: a.usage_status ?? 'unused',
  }));
  const ranked = rankAndCapPlannerAssets(
    summaries,
    { committedAssetIds: new Set<string>(), rejectedAssetIds: new Set<string>() },
    maxAssets,
  );
  let selected = ranked.selected as CandidateSourceAsset[];

  if (excludeSource) {
    selected = selected.filter((a) => !sourceIds.has(a.id));
    const targetCount = sourceIds.size;
    if (selected.length < targetCount) {
      throw new Error(
        `Not enough alternative assets (need ${targetCount}, found ${selected.length} after excluding source footage). Try relaxing eligibility or add more assets.`,
      );
    }
  }

  return selected;
}

async function spawnViaLLM(params: {
  supabase: SupabaseClient;
  source: Record<string, unknown>;
  mode: SpawnMode;
  operatorNotes: string;
  assetRows: CandidateSourceAsset[];
  structureContract: SourceStructureContract;
}): Promise<{ validated: ValidatedPostCandidate; llmModel: string; llmRaw: Record<string, unknown> }> {
  const assetById = new Map(params.assetRows.map((a) => [a.id, a]));
  const assetByDriveId = new Map(
    params.assetRows
      .filter((a) => a.drive_file_id)
      .map((a) => [a.drive_file_id, a]),
  );
  const assetSummaries = params.assetRows.map((a) =>
    buildAssetSummary(a as unknown as ContentAssetRow),
  );

  const apiKey = requireEnv('GEMINI_API_KEY');
  const route = await getResolvedModelRoute(params.supabase, 'candidate_regeneration');
  const composed = await loadComposedStableSystemInstruction(
    params.supabase,
    'task_spawn_candidate_variant',
  );
  const withSeries = await loadComposedSystemInstructionWithSeries(
    params.supabase,
    composed.text,
  );
  const stable = withSeries.instruction;
  const dynamicText = buildCandidateSpawnDynamicPayload({
    spawnMode: params.mode,
    operatorNotes: params.operatorNotes,
    sourceCandidate: buildSourceCandidateJson(params.source),
    sourceStructureContract: params.structureContract,
    assetSummaries,
  });

  const ai = createGeminiClient(apiKey);
  const promptVersion = getFr94PromptVersion();
  const sourceId = String(params.source.id);
  const { response, modelUsed } = await callGeminiWithLogging({
    ai,
    supabase: params.supabase,
    route,
    promptVersion,
    cacheKey: cacheKeyCandidateRegeneration(promptVersion, stable),
    stableSystemInstruction: stable,
    entity: {
      post_candidate_id: sourceId,
      prompt_keys: [...STABLE_CONTEXT_KEYS, 'task_spawn_candidate_variant'],
      pipeline_step: 'candidate_spawn',
    },
    getContentsImplicit: () => [createPartFromText(stable), createPartFromText(dynamicText)],
    getContentsExplicit: () => [createPartFromText(dynamicText)],
  });

  const text = response.text?.trim();
  if (!text) throw new Error('Gemini returned empty text');

  let obj: Record<string, unknown>;
  try {
    obj = normalizeSpawnCandidateShape(unwrapSpawnCandidate(parseGeminiJsonObject(text)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not parse spawn response: ${msg}`);
  }

  const parsed = spawnOutputSchema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`Invalid spawn response schema: ${parsed.error.message}`);
  }

  const validated = validatePostCandidateOutput(
    parsed.data,
    assetById,
    undefined,
    assetByDriveId,
  );
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const stripped = stripStaleAssetRefs(
    validated.data as unknown as Parameters<typeof stripStaleAssetRefs>[0],
    validated.data.source_asset_ids,
  );

  const finalCandidate = {
    ...stripped.rewritten,
    source_drive_file_ids: validated.data.source_drive_file_ids,
  } as ValidatedPostCandidate;

  validateSpawnOutput({
    mode: params.mode,
    source: params.source,
    validated: finalCandidate,
    operatorNotes: params.operatorNotes,
    structureContract: params.structureContract,
  });

  const llmRaw: Record<string, unknown> = {
    ...responseToJson(response),
    text,
    spawn_mode: params.mode,
    spawned_from: sourceId,
  };

  return {
    validated: finalCandidate,
    llmModel: modelUsed,
    llmRaw,
  };
}

async function finalizeSpawnedCandidate(params: {
  supabase: SupabaseClient;
  candidateId: string;
  validated: ValidatedPostCandidate;
  llmModel: string;
  llmRaw: Record<string, unknown>;
  spawnedFromId: string;
  spawnRootId: string;
  mode: SpawnMode;
  operatorNotes: string;
  candidateDate: string;
  preserveTextFrom?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, candidateId, validated } = params;
  const now = new Date().toISOString();

  const insertRes = await insertPostCandidate(supabase, {
    id: candidateId,
    candidateDate: params.candidateDate,
    c: validated,
    llmModel: params.llmModel,
    llmRaw: params.llmRaw,
  });
  if (insertRes.error) throw new Error(insertRes.error);

  const lineageUpdate: Record<string, unknown> = {
    spawned_from_candidate_id: params.spawnedFromId,
    spawn_root_candidate_id: params.spawnRootId,
    spawn_mode: params.mode,
    spawn_notes: params.operatorNotes.trim() || null,
    updated_at: now,
  };

  if (params.preserveTextFrom) {
    lineageUpdate.caption_fr = params.preserveTextFrom.caption_fr;
    lineageUpdate.caption_en = params.preserveTextFrom.caption_en;
    lineageUpdate.hook = params.preserveTextFrom.hook;
    lineageUpdate.concept_summary = params.preserveTextFrom.concept_summary;
  }

  const { error: lineageErr } = await supabase
    .from('post_candidates')
    .update(lineageUpdate)
    .eq('id', candidateId);
  if (lineageErr) throw new Error(lineageErr.message);

  const usageType = mapPostTypeToUsageTypeLocal(validated.post_type);
  const recentLedger = await loadRecentLedger(params.supabase);
  for (const aid of validated.source_asset_ids) {
    await recordAssetUsageEvent(supabase, {
      contentAssetId: aid,
      postCandidateId: candidateId,
      publishingJobId: null,
      usageStage: 'suggested',
      usageType,
      ledgerPostType: validated.post_type,
      usageRole: 'primary',
      lockStrength: 'soft',
      notes: `Spawned from candidate ${params.spawnedFromId} (${params.mode})`,
    });
    await updateAssetUsageSummary(supabase, aid);
  }

  await refreshCandidateAssetConflicts(supabase, candidateId);
  await evaluateCandidateCollision(supabase, candidateId, recentLedger);

  const reviewParentId = requireEnv('GOOGLE_DRIVE_READY_FOR_REVIEW_FOLDER_ID');
  const drive = await getDriveClient();
  const shortId = candidateId.replace(/-/g, '').slice(0, 6);
  const typeSlug = sanitizeFilenamePart(validated.post_type, 20);
  const titleSlug = sanitizeFilenamePart(validated.title, 48);
  const folderName = `${params.candidateDate}_${typeSlug}_${titleSlug}_${shortId}`;

  const folder = await createReviewDriveFolder(drive, {
    parentFolderId: reviewParentId,
    folderName,
  });
  await copyAssetsToReviewFolder(drive, {
    driveFileIds: validated.source_drive_file_ids,
    destFolderId: folder.id,
  });

  const folderUrl = folder.webViewLink ?? driveFolderUrl(folder.id);
  await supabase
    .from('post_candidates')
    .update({
      review_drive_folder_id: folder.id,
      review_drive_folder_name: folder.name,
      review_drive_folder_url: folderUrl,
      updated_at: now,
    })
    .eq('id', candidateId);
}

async function spawnClipReelVariant(params: {
  supabase: SupabaseClient;
  source: Record<string, unknown>;
  mode: SpawnMode;
  operatorNotes: string;
}): Promise<{ candidateId: string; renderQueued: boolean }> {
  const variantBase = buildVariantBaseFromCandidate({
    id: String(params.source.id),
    hook: (params.source.hook as string | null) ?? null,
    selected_series: (params.source.selected_series as string | null) ?? null,
    reel_instructions: params.source.reel_instructions,
  });
  if (!variantBase) {
    throw new Error('Source is not a clip-based reel');
  }

  const kind = reelVariantKindForMode(params.mode);
  let targetSeriesSlug: string | undefined;
  if (kind === 'different_series' || params.mode === 'keep_text_change_assets') {
    const [series, clips] = await Promise.all([
      loadActiveSeries(params.supabase),
      loadReadyClipsForReels(params.supabase, { limit: 200 }),
    ]);
    targetSeriesSlug = pickAlternateSeriesSlug(
      series,
      clips,
      variantBase.selected_series,
    );
    if (params.mode === 'keep_text_change_assets' && !targetSeriesSlug) {
      targetSeriesSlug = variantBase.selected_series ?? undefined;
    }
  }

  const ai = createGeminiClient(requireEnv('GEMINI_API_KEY'));
  const assembled = await assembleReelFromClips({
    supabase: params.supabase,
    ai,
    targetSeriesSlug,
    variant: { kind, base: variantBase },
  });

  if (!assembled.ok) {
    throw new Error(assembled.skipped);
  }

  const spawnRootId = resolveSpawnRoot(params.source);
  const candidateDate =
    typeof params.source.candidate_date === 'string' && params.source.candidate_date.trim()
      ? params.source.candidate_date.trim()
      : new Date().toISOString().slice(0, 10);

  const ins = await insertReelCandidate(params.supabase, {
    reel: assembled.reel,
    candidateDate,
    variantOf: spawnRootId,
    variantKind: kind,
  });
  if (ins.error) throw new Error(ins.error);

  const now = new Date().toISOString();
  const lineageUpdate: Record<string, unknown> = {
    spawned_from_candidate_id: String(params.source.id),
    spawn_root_candidate_id: spawnRootId,
    spawn_mode: params.mode,
    spawn_notes: params.operatorNotes.trim() || null,
    updated_at: now,
  };

  if (params.mode === 'keep_text_change_assets') {
    lineageUpdate.caption_fr = params.source.caption_fr;
    lineageUpdate.caption_en = params.source.caption_en;
    lineageUpdate.hook = params.source.hook;
    lineageUpdate.concept_summary = params.source.concept_summary;
    lineageUpdate.title = params.source.title;
  }

  await params.supabase.from('post_candidates').update(lineageUpdate).eq('id', ins.id);

  for (const aid of assembled.reel.source_asset_ids) {
    await recordAssetUsageEvent(params.supabase, {
      contentAssetId: aid,
      postCandidateId: ins.id,
      publishingJobId: null,
      usageStage: 'suggested',
      usageType: 'reel',
      ledgerPostType: 'reel',
      usageRole: 'primary',
      lockStrength: 'soft',
      notes: `Spawned reel from ${params.source.id} (${params.mode})`,
    });
    await updateAssetUsageSummary(params.supabase, aid);
  }

  await refreshCandidateAssetConflicts(params.supabase, ins.id);
  const recentLedger = await loadRecentLedger(params.supabase);
  await evaluateCandidateCollision(params.supabase, ins.id, recentLedger);

  let renderQueued = false;
  const autoReelRenderEnabled = await loadAutoReelRenderEnabled(params.supabase);
  if (autoReelRenderEnabled) {
    const renderRes = await enqueueReelRenderJob(params.supabase, {
      candidateId: ins.id,
      reel: assembled.reel,
    });
    renderQueued = !renderRes.error;
  }

  return { candidateId: ins.id, renderQueued };
}

export async function spawnCandidateFromSource(params: {
  supabase: SupabaseClient;
  sourceId: string;
  request: SpawnRequest;
}): Promise<{ candidateId: string; renderQueued: boolean }> {
  const { data: row, error: readErr } = await params.supabase
    .from('post_candidates')
    .select('*')
    .eq('id', params.sourceId)
    .maybeSingle();

  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error('Candidate not found');

  const source = row as Record<string, unknown>;
  const status = String(source.status ?? '');
  if (!ALLOWED_SOURCE_STATUSES.has(status)) {
    throw new Error(`Cannot spawn from candidate status "${status}"`);
  }

  const postType = String(source.post_type ?? '');
  const mode = params.request.mode;
  const operatorNotes = params.request.operator_notes ?? '';
  const assetPool = params.request.asset_pool ?? 'planner_eligible';

  if (
    postType === 'reel' &&
    isClipReelInstructions(source.reel_instructions) &&
    mode === 'shuffle_assets'
  ) {
    return spawnClipReelVariant({
      supabase: params.supabase,
      source,
      mode,
      operatorNotes,
    });
  }

  if (
    postType === 'reel' &&
    isClipReelInstructions(source.reel_instructions) &&
    mode === 'keep_text_change_assets'
  ) {
    try {
      return await spawnClipReelVariant({
        supabase: params.supabase,
        source,
        mode,
        operatorNotes,
      });
    } catch {
      /* fall through to LLM spawn */
    }
  }

  const structureContract = buildSourceStructureContract(source);
  const assetRows = await resolveAssetPool(params.supabase, source, assetPool, mode);
  const { validated, llmModel, llmRaw } = await spawnViaLLM({
    supabase: params.supabase,
    source,
    mode,
    operatorNotes,
    assetRows,
    structureContract,
  });

  const candidateId = randomUUID();
  const spawnRootId = resolveSpawnRoot(source);
  const candidateDate =
    typeof source.candidate_date === 'string' && source.candidate_date.trim()
      ? source.candidate_date.trim()
      : new Date().toISOString().slice(0, 10);

  await finalizeSpawnedCandidate({
    supabase: params.supabase,
    candidateId,
    validated,
    llmModel,
    llmRaw,
    spawnedFromId: params.sourceId,
    spawnRootId,
    mode,
    operatorNotes,
    candidateDate,
    preserveTextFrom: mode === 'keep_text_change_assets' ? source : undefined,
  });

  return { candidateId, renderQueued: false };
}
