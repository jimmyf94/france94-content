/**
 * Backfill full-video clip segmentation for library videos that were analyzed
 * before clips-v1 existed (or fell back to sampled).
 *
 * Usage:
 *   npm run backfill:clips -- --asset-id=<uuid>
 *   npm run backfill:clips -- --asset-id=a,b,c --limit=5
 *   npm run backfill:clips
 *
 * Requires VIDEO_ANALYSIS_MODE=full (default). Keeps processed assets on status=processed.
 */
import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchDriveFileMedia, maxAnalysisFileBytes } from './lib/drive-media-download.js';
import { getDriveClient } from './ingest-drive-content.js';
import { replaceContentClips } from './lib/content-clips.js';
import { getFr94PromptVersion } from './lib/ai/prompt-version.js';
import {
  analyzeVideoFull,
  fetchDriveWebViewLink,
  getGenAI,
  getSupabaseClient,
  updateAssetAnalysis,
} from './analyze-content-assets.js';

type AssetRow = {
  id: string;
  drive_file_id: string | null;
  mime_type: string | null;
  file_size: number | string | null;
  original_filename: string;
  current_filename: string | null;
  status: string;
};

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return n;
}

function parseAssetIds(): string[] {
  const ids: string[] = [];
  for (const arg of process.argv) {
    if (arg.startsWith('--asset-id=')) {
      const raw = arg.slice('--asset-id='.length).trim();
      for (const part of raw.split(',')) {
        const id = part.trim();
        if (id) ids.push(id);
      }
    }
  }
  const idx = process.argv.indexOf('--asset-id');
  if (idx >= 0) {
    const raw = process.argv[idx + 1]?.trim();
    if (raw && !raw.startsWith('-')) {
      for (const part of raw.split(',')) {
        const id = part.trim();
        if (id) ids.push(id);
      }
    }
  }
  return [...new Set(ids)];
}

function fileExtensionFromRow(row: AssetRow): string {
  const filename = row.current_filename ?? row.original_filename ?? '';
  const i = filename.lastIndexOf('.');
  if (i > 0 && i < filename.length - 1) {
    return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  }
  const m = (row.mime_type ?? '').toLowerCase();
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'mp4';
}

async function loadTargetAssets(assetIds: string[], limit: number): Promise<AssetRow[]> {
  const supabase = getSupabaseClient();

  if (assetIds.length > 0) {
    const { data, error } = await supabase
      .from('content_assets')
      .select(
        'id, drive_file_id, mime_type, file_size, original_filename, current_filename, status',
      )
      .in('id', assetIds)
      .eq('media_type', 'video');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AssetRow[];
    const missing = assetIds.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length > 0) {
      console.warn(`[backfill:clips]\twarning: not found or not video: ${missing.join(', ')}`);
    }
    return rows;
  }

  const { data: clipRows, error: clipErr } = await supabase
    .from('content_clips')
    .select('content_asset_id');
  if (clipErr) throw new Error(clipErr.message);
  const hasClips = new Set(
    (clipRows ?? [])
      .map((r) => (r as { content_asset_id?: string }).content_asset_id)
      .filter(Boolean) as string[],
  );

  const { data, error } = await supabase
    .from('content_assets')
    .select(
      'id, drive_file_id, mime_type, file_size, original_filename, current_filename, status',
    )
    .eq('media_type', 'video')
    .in('status', ['processed', 'analyzed', 'ready_for_planning'])
    .not('drive_file_id', 'is', null)
    .order('processed_at', { ascending: true, nullsFirst: false })
    .limit(Math.max(limit * 4, limit));

  if (error) throw new Error(error.message);

  return ((data ?? []) as AssetRow[]).filter((r) => !hasClips.has(r.id)).slice(0, limit);
}

async function backfillContentClips(): Promise<void> {
  const assetIds = parseAssetIds();
  const limit = envInt('CLIP_BACKFILL_BATCH_SIZE', 3);
  const rows = await loadTargetAssets(assetIds, limit);

  if (rows.length === 0) {
    console.log('[backfill:clips]\tnothing to process');
    return;
  }

  console.log(`[backfill:clips]\tbatch=${rows.length}\tasset_ids=${assetIds.length > 0 ? 'explicit' : 'auto'}`);

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();
  const ai = getGenAI();
  const maxBytes = maxAnalysisFileBytes();
  const promptVersion = getFr94PromptVersion();
  const llmCtx = { supabase, promptVersion };

  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    const label = row.current_filename ?? row.original_filename;
    const prevStatus = row.status;
    console.log(`[backfill:clips]\tstart\t${row.id}\t${label}\tstatus=${prevStatus}`);

    const driveId = row.drive_file_id?.trim();
    if (!driveId) {
      console.warn(`[backfill:clips]\tskip no drive_file_id\t${row.id}`);
      failed += 1;
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await fetchDriveFileMedia(drive, driveId, maxBytes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[backfill:clips]\tdownload failed\t${row.id}\t${msg}`);
      failed += 1;
      continue;
    }

    const mimeType = row.mime_type?.trim() || 'video/mp4';
    const ext = fileExtensionFromRow(row);

    try {
      const full = await analyzeVideoFull(ai, {
        buffer,
        mimeType,
        displayName: label,
        fileExtension: ext,
        contentAssetId: row.id,
        llm: llmCtx,
      });

      const driveWebViewLink = await fetchDriveWebViewLink(drive, driveId);

      await updateAssetAnalysis(supabase, row.id, {
        analysis: full.analysis,
        llm_model: full.llmModel,
        llm_raw: full.rawResponse,
        drive_web_view_link: driveWebViewLink,
        analysis_strategy: full.strategy,
        duration_seconds: full.durationSeconds,
        video_width: full.width,
        video_height: full.height,
        frame_sample_count: null,
        frame_sample_paths: null,
        audio_transcript: full.audioTranscript,
        latitude: full.latitude,
        longitude: full.longitude,
        altitude: full.altitude,
        capture_time: full.captureTime,
        camera_make: full.cameraMake,
        camera_model: full.cameraModel,
        geo_source: full.latitude != null ? 'ffprobe_quicktime' : null,
      });

      if (prevStatus === 'processed' || prevStatus === 'ready_for_planning') {
        await supabase
          .from('content_assets')
          .update({ status: prevStatus, updated_at: new Date().toISOString() })
          .eq('id', row.id);
      }

      const clipResult = await replaceContentClips(supabase, {
        contentAssetId: row.id,
        clips: full.clips,
        videoBuffer: buffer,
        fileExtension: ext,
      });

      console.log(
        `[backfill:clips]\tok\t${row.id}\tclips=${clipResult.inserted}\tthumbs=${clipResult.thumbnails}\tstrategy=${full.strategy}`,
      );
      ok += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[backfill:clips]\tfailed\t${row.id}\t${msg}`);
      failed += 1;
    }
  }

  console.log(`[backfill:clips]\tsummary ok=${ok} failed=${failed}`);
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  backfillContentClips().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
