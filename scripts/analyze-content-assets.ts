import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FileState, GoogleGenAI, createPartFromText, createPartFromUri } from '@google/genai';
import type { drive_v3 } from 'googleapis';
import { z } from 'zod';

import { driveFileViewUrl, getDriveClient } from './ingest-drive-content.js';

const DEFAULT_ANALYSIS_PROMPT_REL = path.join('prompts', 'france94-media-analysis.txt');

function resolveAnalysisPromptPath(): string {
  const fromEnv = process.env.CONTENT_ANALYSIS_PROMPT_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.join(path.dirname(fileURLToPath(import.meta.url)), DEFAULT_ANALYSIS_PROMPT_REL);
}

function loadAnalysisPrompt(): string {
  const promptPath = resolveAnalysisPromptPath();
  let raw: string;
  try {
    raw = fs.readFileSync(promptPath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read analysis prompt file: ${promptPath}. Set CONTENT_ANALYSIS_PROMPT_PATH or add scripts/prompts/france94-media-analysis.txt.`,
    );
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Analysis prompt file is empty: ${promptPath}`);
  }
  return trimmed;
}

const ANALYSIS_PROMPT = loadAnalysisPrompt();

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
  quality_score: z.number().min(0).max(10),
  mission_score: z.number().min(0).max(10),
  human_score: z.number().min(0).max(10),
  sponsor_safety_score: z.number().min(0).max(10),
  publish_recommendation: publishRecommendationEnum,
});

export type GeminiAnalysis = z.infer<typeof geminiAnalysisSchema>;

type PendingAsset = {
  id: string;
  drive_file_id: string;
  mime_type: string | null;
  file_size: number | string | null;
  original_filename: string;
  current_filename: string | null;
};

class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

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

async function streamToBufferWithLimit(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string);
    total += buf.length;
    if (total > maxBytes) {
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
      throw new FileTooLargeError(`Download exceeded MAX_ANALYSIS_FILE_SIZE_MB (${maxBytes} bytes cap)`);
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

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

export async function fetchDriveFileForAnalysis(
  drive: drive_v3.Drive,
  driveFileId: string,
  maxBytes: number,
): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );

  const stream = res.data as unknown as NodeJS.ReadableStream;
  return streamToBufferWithLimit(stream, maxBytes);
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

function responseToJson(raw: unknown): Record<string, unknown> {
  const r = raw as {
    text?: string;
    candidates?: unknown;
    usageMetadata?: unknown;
    promptFeedback?: unknown;
    modelVersion?: string;
    responseId?: string;
  };
  let cloned: Record<string, unknown> = {};
  try {
    cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  } catch {
    cloned = {};
  }
  return {
    ...cloned,
    text: r.text,
    candidates: r.candidates,
    usageMetadata: r.usageMetadata,
    promptFeedback: r.promptFeedback,
    modelVersion: r.modelVersion,
    responseId: r.responseId,
  };
}

export async function analyzeWithGemini(
  ai: GoogleGenAI,
  params: {
    buffer: Buffer;
    mimeType: string;
    displayName: string;
    model: string;
  },
): Promise<{ analysis: GeminiAnalysis; rawResponse: Record<string, unknown>; uploadedFileName: string }> {
  const { buffer, mimeType, displayName, model } = params;

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

  await waitForGeminiFileActive(ai, uploadedName);

  const refreshed = await ai.files.get({ name: uploadedName });
  const uri = refreshed.uri;
  if (!uri) {
    await safeDeleteGeminiFile(ai, uploadedName);
    throw new Error('Gemini file has no uri after ACTIVE');
  }

  const response = await ai.models.generateContent({
    model,
    contents: [
      createPartFromUri(uri, mimeType),
      createPartFromText(ANALYSIS_PROMPT),
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text?.trim();
  if (!text) {
    await safeDeleteGeminiFile(ai, uploadedName);
    throw new Error('Gemini returned empty text');
  }

  const analysis = parseGeminiJson(text);
  const rawResponse = responseToJson(response);

  await safeDeleteGeminiFile(ai, uploadedName);

  return { analysis, rawResponse, uploadedFileName: uploadedName };
}

export async function updateAssetAnalysis(
  supabase: SupabaseClient,
  assetId: string,
  payload: {
    analysis: GeminiAnalysis;
    llm_model: string;
    llm_raw: Record<string, unknown>;
    drive_web_view_link: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { analysis, llm_model, llm_raw, drive_web_view_link } = payload;

  const { error } = await supabase
    .from('content_assets')
    .update({
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
      quality_score: analysis.quality_score,
      mission_score: analysis.mission_score,
      human_score: analysis.human_score,
      sponsor_safety_score: analysis.sponsor_safety_score,
      publish_recommendation: analysis.publish_recommendation,
      llm_model,
      llm_raw,
      status: 'analyzed',
      updated_at: now,
      error_message: null,
    })
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

export async function analyzePendingAssets(): Promise<void> {
  const batchSize = envInt('CONTENT_ANALYSIS_BATCH_SIZE', 5);
  const maxMb = envInt('MAX_ANALYSIS_FILE_SIZE_MB', 500);
  const maxBytes = maxMb * 1024 * 1024;
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

  requireEnv('GEMINI_API_KEY');

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();
  const ai = getGenAI();

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
      buffer = await fetchDriveFileForAnalysis(drive, asset.drive_file_id, maxBytes);
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

    try {
      console.log(`[gemini]\tupload + analyze\t${asset.id}`);
      const { analysis, rawResponse } = await analyzeWithGemini(ai, {
        buffer,
        mimeType,
        displayName: label,
        model,
      });

      console.log(`[gemini]\tsuccess\t${asset.id}`);

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
        llm_model: model,
        analysis,
      };
      console.log('[llm_result_json]');
      console.log(JSON.stringify(terminalResult, null, 2));

      await updateAssetAnalysis(supabase, asset.id, {
        analysis,
        llm_model: model,
        llm_raw: rawResponse,
        drive_web_view_link: driveWebViewLink,
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
