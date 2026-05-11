import 'dotenv/config';

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI, createPartFromText } from '@google/genai';
import type { drive_v3 } from 'googleapis';
import { z } from 'zod';

import { getDriveClient } from './ingest-drive-content.js';
import { formatGoogleDriveApiError } from './lib/google-drive-auth.js';
import { sanitizeFilenamePart } from './process-analyzed-assets.js';
import { callGeminiWithLogging, getResolvedModelRoute, responseToJson } from './lib/ai/gemini-client.js';
import { cacheKeyCandidateGeneration, getFr94PromptVersion } from './lib/ai/prompt-version.js';
import {
  buildPostPlannerPromptParts,
  loadPostPlannerStablePrompt,
} from './lib/ai/prompts/post-planner.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const postTypeEnum = z.enum([
  'reel',
  'story_sequence',
  'carousel',
  'static_post',
  'sponsor_post',
  'archive_note',
]);

const llmCandidateSchema = z.object({
  post_type: postTypeEnum,
  title: z.string(),
  hook: z.string().optional(),
  concept_summary: z.string().optional(),
  rationale: z.string().optional(),
  caption_fr: z.string(),
  caption_en: z.string().optional(),
  hashtags: z.array(z.string()),
  source_asset_ids: z.array(z.string().uuid()),
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
});

const llmResponseSchema = z.object({
  candidates: z.array(llmCandidateSchema),
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
};

export type ValidatedPostCandidate = z.infer<typeof llmCandidateSchema> & {
  source_drive_file_ids: string[];
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
  };
}

export async function getCandidateSourceAssets(
  supabase: SupabaseClient,
  params: { batchDays: number; maxAssets: number },
): Promise<CandidateSourceAsset[]> {
  const cutoff = new Date(Date.now() - params.batchDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

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
        'geo_label',
        'geo_locality',
        'postal_code',
        'duration_seconds',
        'drive_web_view_link',
        'analysis_status',
      ].join(', '),
    )
    .eq('status', 'processed')
    .eq('analysis_status', 'complete')
    .not('quality_score', 'is', null)
    .gte('processed_at', cutoffIso)
    .or('content_lane.is.null,content_lane.neq.archive')
    .order('processed_at', { ascending: false })
    .limit(params.maxAssets);

  if (error) throw error;
  return (data ?? []) as unknown as CandidateSourceAsset[];
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

export function validatePostCandidateOutput(
  raw: unknown,
  assetById: Map<string, CandidateSourceAsset>,
): { ok: true; data: ValidatedPostCandidate } | { ok: false; error: string } {
  const parsed = llmCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const c = parsed.data;
  const title = c.title?.trim();
  if (!title) {
    return { ok: false, error: 'empty title' };
  }
  if (!c.source_asset_ids.length) {
    return { ok: false, error: 'source_asset_ids empty' };
  }

  const resolvedDriveIds: string[] = [];
  for (const id of c.source_asset_ids) {
    const asset = assetById.get(id);
    if (!asset) {
      return { ok: false, error: `unknown asset id ${id}` };
    }
    resolvedDriveIds.push(asset.drive_file_id);
  }

  let driveIds = c.source_drive_file_ids;
  const mismatched =
    driveIds.length !== resolvedDriveIds.length ||
    driveIds.some((id, i) => id !== resolvedDriveIds[i]);
  if (mismatched) {
    driveIds = resolvedDriveIds;
  }

  return {
    ok: true,
    data: { ...c, title, source_drive_file_ids: driveIds },
  };
}

export async function generatePostCandidatesWithLLM(params: {
  summaries: AssetSummaryForLLM[];
  dailyTarget: number;
  batchDays: number;
  supabase: SupabaseClient | null;
}): Promise<{
  candidates: ValidatedPostCandidate[];
  llmRaw: Record<string, unknown>;
  model: string;
  rawReturnedCount: number;
  validationErrors: string[];
}> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const ai = new GoogleGenAI({ apiKey });
  const stableTemplate = loadPostPlannerStablePrompt();
  const { stableSystemInstruction, dynamicText } = buildPostPlannerPromptParts({
    stableText: stableTemplate,
    summaries: params.summaries as unknown[],
    dailyTarget: params.dailyTarget,
    batchDays: params.batchDays,
  });
  const promptVersion = getFr94PromptVersion();
  const route = await getResolvedModelRoute(params.supabase, 'candidate_generation');

  const { response, modelUsed } = await callGeminiWithLogging({
    ai,
    supabase: params.supabase,
    route,
    promptVersion,
    cacheKey: cacheKeyCandidateGeneration(promptVersion),
    stableSystemInstruction,
    getContentsImplicit: () => [
      createPartFromText(stableSystemInstruction),
      createPartFromText(dynamicText),
    ],
    getContentsExplicit: () => [createPartFromText(dynamicText)],
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned empty text');
  }

  const obj = parseJsonToRecord(text);
  const validated = llmResponseSchema.safeParse(obj);
  if (!validated.success) {
    throw new Error(`Invalid planner response schema: ${validated.error.message}`);
  }

  const assetById = new Map<string, CandidateSourceAsset>(
    params.summaries.map((s) => [
      s.id,
      {
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
      } as CandidateSourceAsset,
    ]),
  );

  const out: ValidatedPostCandidate[] = [];
  const errors: string[] = [];

  for (let i = 0; i < validated.data.candidates.length; i++) {
    const row = validated.data.candidates[i];
    const v = validatePostCandidateOutput(row, assetById);
    if (!v.ok) {
      errors.push(`candidate[${i}]: ${v.error}`);
      continue;
    }
    out.push(v.data);
  }

  const llmRaw: Record<string, unknown> = {
    ...responseToJson(response),
    text,
    validation_errors: errors.length ? errors : undefined,
  };

  return {
    candidates: out,
    llmRaw,
    model: modelUsed,
    rawReturnedCount: validated.data.candidates.length,
    validationErrors: errors,
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
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('post_candidates')
    .update({
      review_drive_folder_id: params.review_drive_folder_id,
      review_drive_folder_name: params.review_drive_folder_name,
      review_drive_folder_url: params.review_drive_folder_url,
      updated_at: now,
    })
    .eq('id', params.id);

  if (error) throw error;
}

export async function generatePostCandidates(): Promise<void> {
  const batchDays = envInt('POST_CANDIDATE_BATCH_DAYS', 14);
  const maxAssets = envInt('POST_CANDIDATE_MAX_ASSETS', 80);
  const dailyTarget = envInt('POST_CANDIDATE_DAILY_TARGET', 5);
  const reviewParentId = requireEnv('GOOGLE_DRIVE_READY_FOR_REVIEW_FOLDER_ID');

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();

  const assets = await getCandidateSourceAssets(supabase, { batchDays, maxAssets });
  console.log(`source assets (processed, last ${batchDays}d, max ${maxAssets}): ${assets.length}`);

  if (assets.length === 0) {
    console.log('summary: no assets to plan; exiting');
    return;
  }

  const summaries = assets.map((a) => buildAssetSummaryForLLM(a));

  let llmResult: Awaited<ReturnType<typeof generatePostCandidatesWithLLM>>;
  try {
    llmResult = await generatePostCandidatesWithLLM({
      summaries,
      dailyTarget,
      batchDays,
      supabase,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`LLM planner failed: ${msg}`);
    throw e;
  }

  const candidateDate = utcDateString();
  const existingTitles = await fetchExistingTitlesForDate(supabase, candidateDate);

  let inserted = 0;
  let foldersCreated = 0;
  let assetsCopied = 0;
  let skippedDedupe = 0;
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

    const id = randomUUID();
    const shortId = id.replace(/-/g, '').slice(0, 6);
    const typeSlug = sanitizeFilenamePart(c.post_type, 20);
    const titleSlug = sanitizeFilenamePart(c.title, 48);
    const folderName = `${candidateDate}_${typeSlug}_${titleSlug}_${shortId}`;

    const insertRes = await insertPostCandidate(supabase, {
      id,
      candidateDate,
      c,
      llmModel: llmResult.model,
      llmRaw: llmResult.llmRaw,
    });

    if (insertRes.error) {
      console.warn(`[insert failed]\t${c.title}\t${insertRes.error}`);
      insertFailures += 1;
      continue;
    }

    existingTitles.add(dedupeKey);
    inserted += 1;

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
      await updatePostCandidateReviewFolder(supabase, {
        id,
        review_drive_folder_id: folder.id,
        review_drive_folder_name: folder.name,
        review_drive_folder_url: folderUrl,
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
      `assets_sent=${summaries.length}`,
      `candidates_valid=${llmResult.candidates.length}`,
      `inserted=${inserted}`,
      `folders_created=${foldersCreated}`,
      `assets_copied=${assetsCopied}`,
      `skipped_dedupe=${skippedDedupe}`,
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
