import fs from 'node:fs';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import { extractFrames, probeVideo, withTempDir } from './video-preprocess.js';

export const DEFAULT_THUMB_MAX_WIDTH = 512;
const JPEG_QUALITY = 82;
/** CDN cache TTL (seconds); Smart CDN revalidates on upsert/delete. */
const STORAGE_CACHE_CONTROL = '31536000';

export type ThumbnailStatus = 'pending' | 'ready' | 'failed';

export function assetThumbnailObjectPath(assetId: string): string {
  return `assets/${assetId.trim()}.jpg`;
}

export function assetThumbnailBucketName(): string {
  return process.env.ASSET_THUMBNAIL_BUCKET?.trim() || 'asset-thumbnails';
}

function mediaCategoryFromMime(mimeType: string | null | undefined): 'image' | 'video' | 'other' {
  const m = (mimeType ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  return 'other';
}

function extensionFromMime(mimeType: string | null | undefined, fileExtension?: string | null): string {
  const ext = fileExtension?.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ext) return ext;
  const m = (mimeType ?? '').toLowerCase();
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('heic') || m.includes('heif')) return 'heic';
  return 'bin';
}

async function generateImageThumbnailJpeg(buffer: Buffer, maxWidth: number): Promise<Buffer | null> {
  try {
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({
        width: maxWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return jpeg.length > 0 ? jpeg : null;
  } catch {
    return null;
  }
}

async function generateVideoThumbnailJpeg(
  buffer: Buffer,
  params: { mimeType: string; fileExtension: string; maxWidth: number },
): Promise<Buffer | null> {
  const ext = params.fileExtension || 'mp4';
  try {
    return await withTempDir('fr94-asset-thumb-', async (dir) => {
      const inputPath = path.join(dir, `input.${ext}`);
      fs.writeFileSync(inputPath, buffer);

      const probe = await probeVideo(inputPath);
      const duration = probe.durationSeconds;
      const t =
        duration != null && duration > 0
          ? Math.min(Math.max(duration * 0.1, 0.25), Math.max(duration - 0.1, 0.25))
          : 0.5;

      const frames = await extractFrames(inputPath, [t], dir, params.maxWidth);
      const framePath = frames[0];
      if (!framePath || !fs.existsSync(framePath)) return null;
      return fs.readFileSync(framePath);
    });
  } catch {
    return null;
  }
}

/**
 * Build a low-res JPEG thumbnail from an in-memory Drive download.
 * Images: sharp resize. Videos: first sampled frame (~10% or 0.5s).
 */
export async function generateAssetThumbnailJpeg(
  buffer: Buffer,
  params: {
    mimeType: string;
    fileExtension?: string | null;
    maxWidth?: number;
  },
): Promise<Buffer | null> {
  if (!buffer.length) return null;

  const maxWidth = params.maxWidth ?? DEFAULT_THUMB_MAX_WIDTH;
  const category = mediaCategoryFromMime(params.mimeType);
  const ext = extensionFromMime(params.mimeType, params.fileExtension);

  if (category === 'image') {
    return generateImageThumbnailJpeg(buffer, maxWidth);
  }
  if (category === 'video') {
    return generateVideoThumbnailJpeg(buffer, {
      mimeType: params.mimeType,
      fileExtension: ext,
      maxWidth,
    });
  }
  return null;
}

export async function uploadAssetThumbnail(
  supabase: SupabaseClient,
  assetId: string,
  jpeg: Buffer,
): Promise<{ objectPath: string; bucket: string }> {
  const bucket = assetThumbnailBucketName();
  const objectPath = assetThumbnailObjectPath(assetId);

  const { error } = await supabase.storage.from(bucket).upload(objectPath, jpeg, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: STORAGE_CACHE_CONTROL,
  });
  if (error) {
    throw new Error(error.message);
  }

  return { objectPath, bucket };
}

export async function persistAssetThumbnailFields(
  supabase: SupabaseClient,
  assetId: string,
  fields: {
    thumbnail_path?: string | null;
    thumbnail_status: ThumbnailStatus;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('content_assets')
    .update({
      thumbnail_path: fields.thumbnail_path ?? null,
      thumbnail_status: fields.thumbnail_status,
      thumbnail_updated_at: now,
      updated_at: now,
    })
    .eq('id', assetId);

  if (error) throw error;
}
