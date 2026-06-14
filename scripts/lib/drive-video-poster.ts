import fs from 'node:fs';
import path from 'node:path';

import type { drive_v3 } from 'googleapis';

import { fetchDriveFileMedia } from './drive-media-download.js';
import { extractPosterFrame, probeVideo, withTempDir } from './video-preprocess.js';

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return n;
}

function maxPosterDownloadBytes(): number {
  const mb = envInt('MAX_REVIEW_POSTER_FILE_SIZE_MB', 200);
  return mb * 1024 * 1024;
}

function extensionFromMime(mimeType: string | null | undefined, name: string): string {
  const m = (mimeType ?? '').toLowerCase();
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  const dot = name.lastIndexOf('.');
  if (dot > 0) return name.slice(dot + 1).toLowerCase() || 'mp4';
  return 'mp4';
}

/**
 * Download a Drive video and extract one JPEG frame for UI posters (queue / review).
 * Returns null when ffmpeg is unavailable or extraction fails.
 */
export async function extractDriveVideoPosterJpeg(
  drive: drive_v3.Drive,
  fileId: string,
  params?: { mimeType?: string | null; name?: string | null; maxWidth?: number },
): Promise<Buffer | null> {
  const id = fileId.trim();
  if (!id) return null;

  const maxWidth = params?.maxWidth ?? 800;
  const name = params?.name?.trim() || 'video.mp4';
  const ext = extensionFromMime(params?.mimeType, name);

  try {
    const buffer = await fetchDriveFileMedia(drive, id, maxPosterDownloadBytes());
    return await withTempDir('fr94-poster-', async (dir) => {
      const inputPath = path.join(dir, `input.${ext}`);
      fs.writeFileSync(inputPath, buffer);

      const probe = await probeVideo(inputPath);
      const duration = probe.durationSeconds;
      const t =
        duration != null && duration > 0
          ? Math.min(Math.max(duration * 0.1, 0.25), Math.max(duration - 0.1, 0.25))
          : 0.5;

      const framePath = await extractPosterFrame(inputPath, t, dir, maxWidth);
      if (!framePath || !fs.existsSync(framePath)) return null;
      return fs.readFileSync(framePath);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[drive-video-poster] ${id}: ${msg}`);
    return null;
  }
}
