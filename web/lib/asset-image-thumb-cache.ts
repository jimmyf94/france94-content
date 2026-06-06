import type { drive_v3 } from 'googleapis';

import { fetchDriveFileMedia } from '@fr94/drive-media-download';

import sharp from 'sharp';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const THUMB_MAX_WIDTH = 400;
const JPEG_QUALITY = 82;

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

type CacheEntry = { jpeg: Buffer; at: number };

const thumbCache = new Map<string, CacheEntry>();

export function getCachedAssetImageThumb(assetId: string): Buffer | null {
  const hit = thumbCache.get(assetId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    thumbCache.delete(assetId);
    return null;
  }
  return hit.jpeg;
}

function setCachedAssetImageThumb(assetId: string, jpeg: Buffer): void {
  if (thumbCache.size >= MAX_ENTRIES) {
    const oldest = thumbCache.keys().next().value;
    if (oldest) thumbCache.delete(oldest);
  }
  thumbCache.set(assetId, { jpeg, at: Date.now() });
}

export async function generateAssetImageThumb(
  drive: drive_v3.Drive,
  assetId: string,
  driveFileId: string,
): Promise<Buffer | null> {
  const cached = getCachedAssetImageThumb(assetId);
  if (cached) return cached;

  try {
    const buffer = await fetchDriveFileMedia(drive, driveFileId, maxThumbDownloadBytes());
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({
        width: THUMB_MAX_WIDTH,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    if (jpeg.length > 0) {
      setCachedAssetImageThumb(assetId, jpeg);
      return jpeg;
    }
    return null;
  } catch {
    return null;
  }
}
