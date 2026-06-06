import type { drive_v3 } from 'googleapis';

import { extractDriveVideoPosterJpeg } from '@fr94/drive-video-poster';

import { isVideoMime } from '@/lib/asset-media-urls';
import {
  singleFlightPoster,
  withDriveRetry,
  withPosterGenerationSlot,
} from '@/lib/poster-generation-limiter';
import type { AssetListRow } from '@/lib/asset-library-types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type CacheEntry = { jpeg: Buffer; at: number };

const posterCache = new Map<string, CacheEntry>();

export function getCachedAssetPoster(assetId: string): Buffer | null {
  const hit = posterCache.get(assetId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    posterCache.delete(assetId);
    return null;
  }
  return hit.jpeg;
}

function setCachedAssetPoster(assetId: string, jpeg: Buffer): void {
  if (posterCache.size >= MAX_ENTRIES) {
    const oldest = posterCache.keys().next().value;
    if (oldest) posterCache.delete(oldest);
  }
  posterCache.set(assetId, { jpeg, at: Date.now() });
}

export async function generateAssetVideoPoster(
  drive: drive_v3.Drive,
  assetId: string,
  driveFileId: string,
  params: { mimeType: string; name?: string | null },
): Promise<Buffer | null> {
  const cached = getCachedAssetPoster(assetId);
  if (cached) return cached;

  return singleFlightPoster(`asset:${assetId}`, async () => {
    const again = getCachedAssetPoster(assetId);
    if (again) return again;

    const jpeg = await withPosterGenerationSlot(() =>
      withDriveRetry(() =>
        extractDriveVideoPosterJpeg(drive, driveFileId, {
          mimeType: params.mimeType,
          name: params.name,
          maxWidth: 800,
        }),
      ),
    );

    if (jpeg && jpeg.length > 0) {
      setCachedAssetPoster(assetId, jpeg);
      return jpeg;
    }

    return null;
  });
}

type WarmRow = Pick<AssetListRow, 'id' | 'drive_file_id' | 'mime_type' | 'media_type'> & {
  final_filename?: string | null;
  current_filename?: string | null;
  original_filename?: string | null;
};

function assetDisplayName(row: WarmRow): string {
  return (
    row.final_filename?.trim() ||
    row.current_filename?.trim() ||
    row.original_filename?.trim() ||
    'video.mp4'
  );
}

const MAX_WARM_ASSET_VIDEOS = 2;

/** Warm a few visible videos only; lazy img load handles the rest. */
export function warmAssetVideoPosters(drive: drive_v3.Drive, rows: WarmRow[]): void {
  let warmed = 0;
  for (const row of rows) {
    if (warmed >= MAX_WARM_ASSET_VIDEOS) break;
    const mime = row.mime_type ?? (row.media_type === 'video' ? 'video/mp4' : '');
    if (!isVideoMime(mime)) continue;
    const driveFileId = row.drive_file_id?.trim();
    if (!driveFileId) continue;
    if (getCachedAssetPoster(row.id)) continue;
    warmed += 1;

    void generateAssetVideoPoster(drive, row.id, driveFileId, {
      mimeType: mime || 'video/mp4',
      name: assetDisplayName(row),
    }).catch(() => {
      /* best-effort warm */
    });
  }
}
