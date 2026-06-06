import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FileTooLargeError,
  fetchDriveFileMedia,
} from './lib/drive-media-download.js';
import {
  generateAssetThumbnailJpeg,
  persistAssetThumbnailFields,
  uploadAssetThumbnail,
} from './lib/asset-thumbnail.js';
import { getDriveClient } from './ingest-drive-content.js';
import { getSupabaseClient } from './analyze-content-assets.js';

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return n;
}

function maxThumbDownloadBytes(): number {
  const mb = envInt('MAX_ASSET_THUMB_FILE_SIZE_MB', 30);
  return mb * 1024 * 1024;
}

function fileExtensionFromRow(row: {
  mime_type: string | null;
  current_filename: string | null;
  original_filename: string | null;
}): string {
  const filename = row.current_filename ?? row.original_filename ?? '';
  const i = filename.lastIndexOf('.');
  if (i > 0 && i < filename.length - 1) {
    return filename.slice(i + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  }
  const m = (row.mime_type ?? '').toLowerCase();
  if (m === 'video/mp4') return 'mp4';
  if (m === 'video/quicktime') return 'mov';
  if (m === 'video/webm') return 'webm';
  return 'mp4';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

type BackfillRow = {
  id: string;
  drive_file_id: string;
  mime_type: string | null;
  current_filename: string | null;
  original_filename: string | null;
};

async function backfillAssetThumbnails(): Promise<void> {
  const batchSize = envInt('THUMBNAIL_BACKFILL_BATCH_SIZE', 10);
  const concurrency = envInt('THUMBNAIL_BACKFILL_CONCURRENCY', 3);
  const retryFailed = process.argv.includes('--retry-failed');
  const maxBytes = maxThumbDownloadBytes();

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();

  let query = supabase
    .from('content_assets')
    .select('id, drive_file_id, mime_type, current_filename, original_filename')
    .eq('status', 'processed')
    .is('thumbnail_path', null)
    .order('processed_at', { ascending: true })
    .limit(batchSize);

  if (!retryFailed) {
    query = query.or('thumbnail_status.is.null,thumbnail_status.neq.failed');
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as BackfillRow[];
  if (rows.length === 0) {
    console.log('backfill: nothing to process');
    return;
  }

  let ready = 0;
  let failed = 0;

  await mapWithConcurrency(rows, concurrency, async (row) => {
    const label = row.current_filename ?? row.original_filename ?? row.id;
    const driveFileId = row.drive_file_id?.trim();
    if (!driveFileId) {
      await persistAssetThumbnailFields(supabase, row.id, { thumbnail_status: 'failed' });
      failed += 1;
      console.warn(`[backfill] skip no drive_file_id\t${row.id}`);
      return;
    }

    const mimeType = row.mime_type?.trim() || 'application/octet-stream';
    let buffer: Buffer;
    try {
      buffer = await fetchDriveFileMedia(drive, driveFileId, maxBytes);
    } catch (e) {
      await persistAssetThumbnailFields(supabase, row.id, { thumbnail_status: 'failed' });
      failed += 1;
      const msg =
        e instanceof FileTooLargeError
          ? 'too_large'
          : e instanceof Error
            ? e.message
            : String(e);
      console.warn(`[backfill] download failed\t${label}\t${msg}`);
      return;
    }

    const jpeg = await generateAssetThumbnailJpeg(buffer, {
      mimeType,
      fileExtension: fileExtensionFromRow(row),
    });

    if (!jpeg?.length) {
      await persistAssetThumbnailFields(supabase, row.id, { thumbnail_status: 'failed' });
      failed += 1;
      console.warn(`[backfill] generate failed\t${label}`);
      return;
    }

    try {
      const { objectPath } = await uploadAssetThumbnail(supabase, row.id, jpeg);
      await persistAssetThumbnailFields(supabase, row.id, {
        thumbnail_path: objectPath,
        thumbnail_status: 'ready',
      });
      ready += 1;
      console.log(`[backfill] ready\t${label}\t${objectPath}`);
    } catch (e) {
      await persistAssetThumbnailFields(supabase, row.id, { thumbnail_status: 'failed' });
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[backfill] upload failed\t${label}\t${msg}`);
    }
  });

  console.log(`backfill summary: batch=${rows.length} ready=${ready} failed=${failed}`);
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  backfillAssetThumbnails().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
