import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FileState, GoogleGenAI, createPartFromText, createPartFromUri } from '@google/genai';
import type { drive_v3 } from 'googleapis';
import { z } from 'zod';

import {
  FileTooLargeError,
  fetchDriveFileMedia,
  maxAnalysisFileBytes,
} from './lib/drive-media-download.js';
import { driveFileViewUrl, getDriveClient } from './ingest-drive-content.js';
import {
  extractAudio,
  extractFrames,
  pickFrameTimestamps,
  probeVideo,
  withTempDir,
} from './lib/video-preprocess.js';
import { callGeminiWithLogging, getResolvedModelRoute, responseToJson } from './lib/ai/gemini-client.js';
import {
  cacheKeyAssetAnalysisImage,
  cacheKeyAssetAnalysisVideoSampledAudio,
  cacheKeyAssetAnalysisVideoSampledFrames,
  getFr94PromptVersion,
} from './lib/ai/prompt-version.js';
import {
  buildDirectMediaAnalysisDynamicText,
  buildVideoSampledMetadataDynamicText,
  buildVideoSampledTranscriptSuffix,
  loadAudioTranscriptionStablePrompt,
  loadDirectMediaAnalysisStablePrompt,
  loadVideoSampledAnalysisStablePrompt,
} from './lib/ai/prompts/asset-analysis.js';

const activityEnum = z.enum([
  'run',
  'bike',
  'swim',
  'strength',
  'recovery',
  'travel',
  'admin',
  'sponsor',
  'route',
  'personal',
  'other',
]);

const contentLaneEnum = z.enum(['story', 'reel', 'post', 'carousel', 'sponsor', 'archive']);

const publishRecommendationEnum = z.enum([
  'publish_now',
  'save_for_later',
  'story_only',
  'archive',
  'needs_human_review',
]);

const geminiAnalysisSchema = z.object({
  visual_summary: z.string(),
  transcript: z.string(),
  semantic_summary: z.string(),
  activity: activityEnum,
  content_lane: contentLaneEnum,
  suggested_title: z.string(),
  suggested_filename_core: z
    .string()
    .max(60)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'suggested_filename_core must be lowercase segments separated by hyphens',
    ),
  tags: z.array(z.string()),
  nonverbal_cues: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.string()).max(20))
    .default([]),
  quality_score: z.number().min(0).max(10),
  mission_score: z.number().min(0).max(10),
  human_score: z.number().min(0).max(10),
  sponsor_safety_score: z.number().min(0).max(10),
  publish_recommendation: publishRecommendationEnum,
  needs_full_video_review: z
    .preprocess((v) => (typeof v === 'boolean' ? v : false), z.boolean())
    .default(false),
  reason_full_video_review_needed: z
    .preprocess((v) => (typeof v === 'string' ? v : ''), z.string())
    .default(''),
});

export type GeminiAnalysis = z.infer<typeof geminiAnalysisSchema>;

export type AnalysisStrategy =
  | 'image_direct'
  | 'video_frames_only'
  | 'video_frames_plus_audio'
  | 'video_full_low_res'
  | 'audio_only'
  | 'too_large';

type MediaCategory = 'image' | 'video' | 'audio' | 'other';

type PendingAsset = {
  id: string;
  drive_file_id: string;
  mime_type: string | null;
  file_size: number | string | null;
  original_filename: string;
  current_filename: string | null;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function truncateErrorMessage(msg: string, max = 2000): string {
  if (msg.length <= max) return msg;
  return `${msg.slice(0, max)}…`;
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

function coerceBigIntFileSize(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getGenAI(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
}

async function countPendingAssets(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('content_assets')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'new');
  if (error) throw error;
  return count ?? 0;
}

export async function getPendingAssets(
  supabase: SupabaseClient,
  limit: number,
): Promise<PendingAsset[]> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('id, drive_file_id, mime_type, file_size, original_filename, current_filename')
    .eq('status', 'new')
    .order('imported_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as PendingAsset[];
}

/** Atomically claims a row for analysis. Returns false if another worker already claimed it. */
export async function markAssetAnalyzing(supabase: SupabaseClient, assetId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('content_assets')
    .update({
      status: 'analyzing',
      analysis_status: 'processing',
      updated_at: now,
    })
    .eq('id', assetId)
    .eq('status', 'new')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export const tryMarkAssetAnalyzing = markAssetAnalyzing;

export async function fetchDriveWebViewLink(
  drive: drive_v3.Drive,
  driveFileId: string,
): Promise<string> {
  const res = await drive.files.get({
    fileId: driveFileId,
    fields: 'webViewLink',
    supportsAllDrives: true,
  });
  const link = res.data.webViewLink?.trim();
  return link || driveFileViewUrl(driveFileId);
}

export async function waitForGeminiFileActive(
  ai: GoogleGenAI,
  fileName: string,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const file = await ai.files.get({ name: fileName });
    if (file.state === FileState.FAILED) {
      const msg = file.error?.message ?? 'Gemini file processing failed';
      throw new Error(msg);
    }
    if (file.state === FileState.ACTIVE) {
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`Timed out waiting for Gemini file to become ACTIVE: ${fileName}`);
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

/** Parse model output; one repair pass extracts JSON object from surrounding text. */
export function parseGeminiJson(rawText: string): GeminiAnalysis {
  const trimmed = stripCodeFences(rawText.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const extracted = extractJsonObject(trimmed);
    if (!extracted) {
      throw new Error('Model output was not valid JSON (repair pass found no JSON object)');
    }
    try {
      parsed = JSON.parse(extracted);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`JSON repair pass failed: ${msg}`);
    }
  }

  const result = geminiAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid analysis schema: ${result.error.message}`);
  }
  return result.data;
}

async function safeDeleteGeminiFile(ai: GoogleGenAI, fileName: string | undefined): Promise<void> {
  if (!fileName) return;
  try {
    await ai.files.delete({ name: fileName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[warn] failed to delete Gemini file ${fileName}: ${msg}`);
  }
}

export async function analyzeWithGemini(
  ai: GoogleGenAI,
  params: {
    buffer: Buffer;
    mimeType: string;
    displayName: string;
    prompt?: string;
    llm?: { supabase: SupabaseClient | null; promptVersion: string };
    subOperation?: string;
  },
): Promise<{
  analysis: GeminiAnalysis;
  rawResponse: Record<string, unknown>;
  uploadedFileName: string;
  llmModel: string;
}> {
  const { buffer, mimeType, displayName } = params;
  const route = await getResolvedModelRoute(params.llm?.supabase ?? null, 'asset_analysis_image');
  const stable = params.prompt ?? loadDirectMediaAnalysisStablePrompt();
  const dynamic = buildDirectMediaAnalysisDynamicText();
  const fullText = dynamic.trim() ? `${stable}\n\n${dynamic}` : stable;

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });

  const uploaded = await ai.files.upload({
    file: blob,
    config: {
      mimeType,
      displayName: displayName.slice(0, 480),
    },
  });

  const uploadedName = uploaded.name;
  if (!uploadedName) {
    throw new Error('Gemini files.upload returned no file name');
  }

  try {
    await waitForGeminiFileActive(ai, uploadedName);

    const refreshed = await ai.files.get({ name: uploadedName });
    const uri = refreshed.uri;
    if (!uri) {
      throw new Error('Gemini file has no uri after ACTIVE');
    }

    const promptVersion = params.llm?.promptVersion ?? getFr94PromptVersion();
    const { response, modelUsed } = await callGeminiWithLogging({
      ai,
      supabase: params.llm?.supabase ?? null,
      route,
      subOperation: params.subOperation ?? 'direct_media',
      promptVersion,
      cacheKey: cacheKeyAssetAnalysisImage(promptVersion),
      stableSystemInstruction: stable,
      disableExplicitCaching: params.prompt !== undefined,
      getContentsImplicit: () => [
        createPartFromUri(uri, mimeType),
        createPartFromText(fullText),
      ],
      getContentsExplicit: () =>
        dynamic.trim()
          ? [createPartFromUri(uri, mimeType), createPartFromText(dynamic)]
          : [createPartFromUri(uri, mimeType)],
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error('Gemini returned empty text');
    }

    const analysis = parseGeminiJson(text);
    const rawResponse = responseToJson(response);

    return { analysis, rawResponse, uploadedFileName: uploadedName, llmModel: modelUsed };
  } finally {
    await safeDeleteGeminiFile(ai, uploadedName);
  }
}

export function mediaCategoryFromMime(mimeType: string | null | undefined): MediaCategory {
  const m = (mimeType ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'other';
}

function fileExtensionFromAsset(asset: PendingAsset): string {
  const filename = asset.current_filename ?? asset.original_filename ?? '';
  const i = filename.lastIndexOf('.');
  if (i > 0 && i < filename.length - 1) {
    return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  }
  const m = (asset.mime_type ?? '').toLowerCase();
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  if (m === 'video/x-matroska') return 'mkv';
  return 'mp4';
}

async function transcribeAudioWithGemini(
  ai: GoogleGenAI,
  params: {
    wavBuffer: Buffer;
    displayName: string;
    llm?: { supabase: SupabaseClient | null; promptVersion: string };
  },
): Promise<string> {
  const { wavBuffer, displayName } = params;
  const route = await getResolvedModelRoute(params.llm?.supabase ?? null, 'asset_analysis_video_sampled');
  const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });

  const uploaded = await ai.files.upload({
    file: blob,
    config: { mimeType: 'audio/wav', displayName: displayName.slice(0, 480) },
  });

  const uploadedName = uploaded.name;
  if (!uploadedName) {
    throw new Error('Audio upload returned no file name');
  }

  try {
    await waitForGeminiFileActive(ai, uploadedName);
    const refreshed = await ai.files.get({ name: uploadedName });
    const uri = refreshed.uri;
    if (!uri) {
      throw new Error('Audio file has no uri after ACTIVE');
    }

    const stable = loadAudioTranscriptionStablePrompt();
    const promptVersion = params.llm?.promptVersion ?? getFr94PromptVersion();
    const { response } = await callGeminiWithLogging({
      ai,
      supabase: params.llm?.supabase ?? null,
      route,
      subOperation: 'audio_transcription',
      promptVersion,
      cacheKey: cacheKeyAssetAnalysisVideoSampledAudio(promptVersion),
      stableSystemInstruction: stable,
      jsonResponse: false,
      getContentsImplicit: () => [
        createPartFromUri(uri, 'audio/wav'),
        createPartFromText(stable),
      ],
      getContentsExplicit: () => [createPartFromUri(uri, 'audio/wav')],
    });

    return response.text?.trim() ?? '';
  } finally {
    await safeDeleteGeminiFile(ai, uploadedName);
  }
}

export type VideoSampledResult = {
  analysis: GeminiAnalysis;
  rawResponse: Record<string, unknown>;
  strategy: 'video_frames_only' | 'video_frames_plus_audio';
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameSamplePaths: string[];
  audioTranscript: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  captureTime: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  llmModel: string;
};

export async function analyzeVideoSampled(
  ai: GoogleGenAI,
  params: {
    buffer: Buffer;
    mimeType: string;
    displayName: string;
    fileExtension: string;
    config: {
      mode: 'sampled' | 'frames_only';
      frameMaxWidth: number;
      maxSampleFrames: number;
    };
    llm?: { supabase: SupabaseClient | null; promptVersion: string };
  },
): Promise<VideoSampledResult> {
  const { buffer, mimeType, displayName, fileExtension, config } = params;
  const route = await getResolvedModelRoute(params.llm?.supabase ?? null, 'asset_analysis_video_sampled');

  return await withTempDir('fr94-video-', async (dir) => {
    const inputPath = path.join(dir, `input.${fileExtension}`);
    fs.writeFileSync(inputPath, buffer);

    const probe = await probeVideo(inputPath);
    console.log(
      `[ffprobe]\tduration=${probe.durationSeconds ?? 'null'}s\t${probe.width ?? '?'}x${probe.height ?? '?'}\taudio=${probe.hasAudio}`,
    );

    if (probe.durationSeconds == null) {
      throw new Error('ffprobe did not return a duration; cannot sample frames.');
    }

    const timestamps = pickFrameTimestamps(probe.durationSeconds, config.maxSampleFrames);
    if (timestamps.length === 0) {
      throw new Error(`Could not pick any frame timestamps for duration=${probe.durationSeconds}`);
    }

    const framePaths = await extractFrames(inputPath, timestamps, dir, config.frameMaxWidth);
    console.log(`[ffmpeg]\textracted ${framePaths.length} frames at [${timestamps.join(', ')}]s`);

    let strategy: 'video_frames_only' | 'video_frames_plus_audio' = 'video_frames_only';
    let audioTranscript = '';

    if (probe.hasAudio && config.mode === 'sampled') {
      const audioPath = path.join(dir, 'audio.wav');
      try {
        await extractAudio(inputPath, audioPath);
        const wavBuf = fs.readFileSync(audioPath);
        audioTranscript = await transcribeAudioWithGemini(ai, {
          wavBuffer: wavBuf,
          displayName: `${displayName}.audio`,
          llm: params.llm,
        });
        if (audioTranscript.trim()) {
          strategy = 'video_frames_plus_audio';
        }
        console.log(`[gemini]\ttranscribed audio chars=${audioTranscript.length}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[warn] audio transcription failed; continuing frames-only: ${msg}`);
        audioTranscript = '';
        strategy = 'video_frames_only';
      }
    }

    const frameParts = framePaths.map((p) => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: fs.readFileSync(p).toString('base64'),
      },
    }));

    const metadataPayload = {
      original_filename: displayName,
      mime_type: mimeType,
      duration_seconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      frame_count: framePaths.length,
      frame_timestamps_seconds: timestamps,
      has_audio: probe.hasAudio,
    };
    const stableVideo = loadVideoSampledAnalysisStablePrompt();
    const dynamicMeta = buildVideoSampledMetadataDynamicText(metadataPayload);
    const transcriptSuffix = buildVideoSampledTranscriptSuffix(audioTranscript);

    const buildPromptParts = (stablePrefix: string, dynamicOnly: boolean) => {
      const head = dynamicOnly
        ? dynamicMeta
        : `${stablePrefix}\n\n${dynamicMeta}`;
      const parts: Array<
        ReturnType<typeof createPartFromText> | { inlineData: { mimeType: string; data: string } }
      > = [createPartFromText(head), ...frameParts];
      if (transcriptSuffix) {
        parts.push(createPartFromText(transcriptSuffix));
      }
      return parts;
    };

    const promptVersion = params.llm?.promptVersion ?? getFr94PromptVersion();
    const { response, modelUsed } = await callGeminiWithLogging({
      ai,
      supabase: params.llm?.supabase ?? null,
      route,
      subOperation: 'video_sampled',
      promptVersion,
      cacheKey: cacheKeyAssetAnalysisVideoSampledFrames(promptVersion),
      stableSystemInstruction: stableVideo,
      getContentsImplicit: () => buildPromptParts(stableVideo, false),
      getContentsExplicit: () => buildPromptParts('', true),
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error('Gemini returned empty text for video sampled analysis');
    }

    const analysis = parseGeminiJson(text);
    const rawResponse = responseToJson(response);

    return {
      analysis,
      rawResponse,
      strategy,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      frameSamplePaths: framePaths.map((p) => path.basename(p)),
      audioTranscript,
      latitude: probe.latitude,
      longitude: probe.longitude,
      altitude: probe.altitude,
      captureTime: probe.captureTime,
      cameraMake: probe.cameraMake,
      cameraModel: probe.cameraModel,
      llmModel: modelUsed,
    };
  });
}

export async function updateAssetAnalysis(
  supabase: SupabaseClient,
  assetId: string,
  payload: {
    analysis: GeminiAnalysis;
    llm_model: string;
    llm_raw: Record<string, unknown>;
    drive_web_view_link: string;
    analysis_strategy: AnalysisStrategy;
    duration_seconds?: number | null;
    video_width?: number | null;
    video_height?: number | null;
    frame_sample_count?: number | null;
    frame_sample_paths?: string[] | null;
    audio_transcript?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    altitude?: number | null;
    capture_time?: string | null;
    camera_make?: string | null;
    camera_model?: string | null;
    geo_source?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const {
    analysis,
    llm_model,
    llm_raw,
    drive_web_view_link,
    analysis_strategy,
    duration_seconds = null,
    video_width = null,
    video_height = null,
    frame_sample_count = null,
    frame_sample_paths = null,
    audio_transcript = null,
    geo_source,
  } = payload;

  const update: Record<string, unknown> = {
    analyzed_at: now,
    analysis_status: 'complete',
    drive_web_view_link,
    visual_summary: analysis.visual_summary,
    transcript: analysis.transcript,
    semantic_summary: analysis.semantic_summary,
    activity: analysis.activity,
    content_lane: analysis.content_lane,
    suggested_title: analysis.suggested_title,
    suggested_filename_core: analysis.suggested_filename_core,
    tags: analysis.tags,
    nonverbal_cues: analysis.nonverbal_cues,
    quality_score: analysis.quality_score,
    mission_score: analysis.mission_score,
    human_score: analysis.human_score,
    sponsor_safety_score: analysis.sponsor_safety_score,
    publish_recommendation: analysis.publish_recommendation,
    analysis_strategy,
    duration_seconds,
    video_width,
    video_height,
    frame_sample_count,
    frame_sample_paths,
    audio_transcript,
    needs_full_video_review: analysis.needs_full_video_review,
    reason_full_video_review_needed:
      analysis.reason_full_video_review_needed?.trim() ? analysis.reason_full_video_review_needed : null,
    llm_model,
    llm_raw,
    status: 'analyzed',
    updated_at: now,
    error_message: null,
  };

  // Only touch geo columns when the analyzer extracted them (videos via ffprobe).
  // Image rows already had geo populated at ingest from Drive imageMediaMetadata.
  if (geo_source) {
    update.geo_source = geo_source;
    update.latitude = payload.latitude ?? null;
    update.longitude = payload.longitude ?? null;
    update.altitude = payload.altitude ?? null;
    update.capture_time = payload.capture_time ?? null;
    update.camera_make = payload.camera_make ?? null;
    update.camera_model = payload.camera_model ?? null;
  }

  const { error } = await supabase
    .from('content_assets')
    .update(update)
    .eq('id', assetId);

  if (error) throw error;
}

export async function markAssetError(
  supabase: SupabaseClient,
  assetId: string,
  error: unknown,
  analysisStatus: 'failed' | 'too_large' = 'failed',
): Promise<void> {
  const message =
    error instanceof FileTooLargeError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);

  const finalAnalysisStatus = error instanceof FileTooLargeError ? 'too_large' : analysisStatus;

  const { error: updateErr } = await supabase
    .from('content_assets')
    .update({
      status: 'error',
      analysis_status: finalAnalysisStatus,
      error_message: truncateErrorMessage(message),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId);

  if (updateErr) throw updateErr;
}

function resolveVideoAnalysisMode(): 'sampled' | 'frames_only' {
  const raw = process.env.VIDEO_ANALYSIS_MODE?.trim().toLowerCase();
  if (!raw) return 'sampled';
  if (raw === 'sampled' || raw === 'frames_only') return raw;
  throw new Error(`Invalid VIDEO_ANALYSIS_MODE: ${raw} (expected sampled or frames_only)`);
}

export async function analyzePendingAssets(): Promise<void> {
  const batchSize = envInt('CONTENT_ANALYSIS_BATCH_SIZE', 5);
  const maxBytes = maxAnalysisFileBytes();

  const videoMode = resolveVideoAnalysisMode();
  const videoFrameMaxWidth = envInt('VIDEO_FRAME_MAX_WIDTH', 768);
  const videoMaxSampleFrames = envInt('VIDEO_MAX_SAMPLE_FRAMES', 12);

  requireEnv('GEMINI_API_KEY');

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();
  const ai = getGenAI();
  const promptVersion = getFr94PromptVersion();
  const llmCtx = { supabase, promptVersion };

  const pending = await countPendingAssets(supabase);
  console.log(`pending content_assets (status=new): ${pending}`);

  const rows = await getPendingAssets(supabase, batchSize);
  if (rows.length === 0) {
    console.log('nothing to process');
    console.log('summary: processed=0 analyzed=0 failed=0 skipped=0');
    return;
  }

  let analyzed = 0;
  let failed = 0;
  let skipped = 0;

  for (const asset of rows) {
    const label = asset.current_filename ?? asset.original_filename;
    console.log(`--- asset ${asset.id} (${label}) ---`);

    const claimed = await markAssetAnalyzing(supabase, asset.id);
    if (!claimed) {
      skipped += 1;
      console.log(`[skipped] could not claim (already analyzing/processed)\t${asset.id}`);
      continue;
    }

    console.log(`[status]\tnew → analyzing\t${asset.id}`);

    const dbSize = coerceBigIntFileSize(asset.file_size);
    if (dbSize != null && dbSize > maxBytes) {
      console.log(`[too_large] DB file_size exceeds cap\t${asset.id}`);
      await markAssetError(
        supabase,
        asset.id,
        new FileTooLargeError(`file_size from Drive metadata (${dbSize} bytes) exceeds cap (${maxBytes} bytes)`),
        'too_large',
      );
      failed += 1;
      continue;
    }

    const mimeType = asset.mime_type?.trim() || 'application/octet-stream';

    let buffer: Buffer;
    try {
      console.log(`[drive]\tdownloading\t${asset.drive_file_id}`);
      buffer = await fetchDriveFileMedia(drive, asset.drive_file_id, maxBytes);
    } catch (e) {
      if (e instanceof FileTooLargeError) {
        await markAssetError(supabase, asset.id, e, 'too_large');
      } else {
        await markAssetError(supabase, asset.id, e, 'failed');
      }
      failed += 1;
      continue;
    }

    console.log(`[drive]\tfetched bytes=${buffer.length}\t${asset.id}`);

    const category = mediaCategoryFromMime(mimeType);

    try {
      let analysis: GeminiAnalysis;
      let rawResponse: Record<string, unknown>;
      let strategy: AnalysisStrategy;
      let durationSeconds: number | null = null;
      let videoWidth: number | null = null;
      let videoHeight: number | null = null;
      let frameSampleCount: number | null = null;
      let frameSamplePaths: string[] | null = null;
      let audioTranscript: string | null = null;
      let videoLatitude: number | null = null;
      let videoLongitude: number | null = null;
      let videoAltitude: number | null = null;
      let videoCaptureTime: string | null = null;
      let videoCameraMake: string | null = null;
      let videoCameraModel: string | null = null;
      let videoGeoSource: string | null = null;
      let llmModelForDb = '';

      if (category === 'video') {
        console.log(`[video]\tsampled preprocess + analyze\t${asset.id}`);
        const result = await analyzeVideoSampled(ai, {
          buffer,
          mimeType,
          displayName: label,
          fileExtension: fileExtensionFromAsset(asset),
          config: {
            mode: videoMode,
            frameMaxWidth: videoFrameMaxWidth,
            maxSampleFrames: videoMaxSampleFrames,
          },
          llm: llmCtx,
        });
        analysis = result.analysis;
        rawResponse = result.rawResponse;
        strategy = result.strategy;
        durationSeconds = result.durationSeconds;
        videoWidth = result.width;
        videoHeight = result.height;
        frameSampleCount = result.frameSamplePaths.length;
        frameSamplePaths = result.frameSamplePaths;
        audioTranscript = result.audioTranscript || null;
        videoLatitude = result.latitude;
        videoLongitude = result.longitude;
        videoAltitude = result.altitude;
        videoCaptureTime = result.captureTime;
        videoCameraMake = result.cameraMake;
        videoCameraModel = result.cameraModel;
        if (result.latitude != null && result.longitude != null) {
          videoGeoSource = 'ffprobe_quicktime';
          console.log(
            `[geo]\tlat=${result.latitude}\tlon=${result.longitude}\tsrc=ffprobe_quicktime\t${asset.id}`,
          );
        }
        llmModelForDb = result.llmModel;
      } else {
        console.log(`[gemini]\tupload + analyze\t${asset.id}`);
        const result = await analyzeWithGemini(ai, {
          buffer,
          mimeType,
          displayName: label,
          llm: llmCtx,
          subOperation:
            category === 'audio' ? 'audio_direct' : category === 'image' ? 'image_direct' : 'other_media',
        });
        analysis = result.analysis;
        rawResponse = result.rawResponse;
        strategy = category === 'audio' ? 'audio_only' : 'image_direct';
        llmModelForDb = result.llmModel;
      }

      console.log(`[gemini]\tsuccess strategy=${strategy}\t${asset.id}`);

      let driveWebViewLink: string;
      try {
        driveWebViewLink = await fetchDriveWebViewLink(drive, asset.drive_file_id);
      } catch (linkErr) {
        const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
        console.warn(`[warn] drive webViewLink fetch failed, using constructed URL: ${msg}`);
        driveWebViewLink = driveFileViewUrl(asset.drive_file_id);
      }

      const terminalResult = {
        asset_id: asset.id,
        drive_file_id: asset.drive_file_id,
        drive_web_view_link: driveWebViewLink,
        llm_model: llmModelForDb,
        analysis_strategy: strategy,
        duration_seconds: durationSeconds,
        video_width: videoWidth,
        video_height: videoHeight,
        frame_sample_count: frameSampleCount,
        analysis,
      };
      console.log('[llm_result_json]');
      console.log(JSON.stringify(terminalResult, null, 2));

      await updateAssetAnalysis(supabase, asset.id, {
        analysis,
        llm_model: llmModelForDb,
        llm_raw: rawResponse,
        drive_web_view_link: driveWebViewLink,
        analysis_strategy: strategy,
        duration_seconds: durationSeconds,
        video_width: videoWidth,
        video_height: videoHeight,
        frame_sample_count: frameSampleCount,
        frame_sample_paths: frameSamplePaths,
        audio_transcript: audioTranscript,
        latitude: videoLatitude,
        longitude: videoLongitude,
        altitude: videoAltitude,
        capture_time: videoCaptureTime,
        camera_make: videoCameraMake,
        camera_model: videoCameraModel,
        geo_source: videoGeoSource,
      });

      console.log(`[supabase]\tstatus=analyzed\t${asset.id}`);
      analyzed += 1;
    } catch (e) {
      await markAssetError(supabase, asset.id, e, 'failed');
      console.log(
        `[failed]\t${asset.id}\t${truncateErrorMessage(e instanceof Error ? e.message : String(e), 400)}`,
      );
      failed += 1;
    }
  }

  const processed = analyzed + failed;
  console.log(`summary: processed=${processed} analyzed=${analyzed} failed=${failed} skipped=${skipped}`);
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  analyzePendingAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
