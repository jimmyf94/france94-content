import type { drive_v3 } from 'googleapis';

import { extractDriveVideoPosterJpeg } from '@fr94/drive-video-poster';

import { listReviewFolderFiles } from '@/lib/list-review-folder';
import {
  singleFlightPoster,
  withDriveRetry,
  withPosterGenerationSlot,
} from '@/lib/poster-generation-limiter';
import { isVideoMime } from '@/lib/review-drive-poster-url';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type CacheEntry = { jpeg: Buffer; at: number };

const coverCache = new Map<string, CacheEntry>();

export function getCachedCandidateCoverPoster(candidateId: string): Buffer | null {
  const hit = coverCache.get(candidateId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    coverCache.delete(candidateId);
    return null;
  }
  return hit.jpeg;
}

function setCachedCandidateCoverPoster(candidateId: string, jpeg: Buffer): void {
  if (coverCache.size >= MAX_ENTRIES) {
    const oldest = coverCache.keys().next().value;
    if (oldest) coverCache.delete(oldest);
  }
  coverCache.set(candidateId, { jpeg, at: Date.now() });
}

export type CandidateCoverVideo = {
  fileId: string;
  mimeType: string;
  name: string;
};

export async function findFirstReviewFolderVideo(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<CandidateCoverVideo | null> {
  const files = await withDriveRetry(() => listReviewFolderFiles(drive, folderId));
  const firstVideo = files.find((f) => f.id && isVideoMime(f.mimeType ?? ''));
  if (!firstVideo?.id) return null;
  return {
    fileId: firstVideo.id,
    mimeType: firstVideo.mimeType ?? 'video/mp4',
    name: firstVideo.name ?? 'video.mp4',
  };
}

export async function generateCandidateCoverPoster(
  drive: drive_v3.Drive,
  candidateId: string,
  folderId: string,
): Promise<Buffer | null> {
  const cached = getCachedCandidateCoverPoster(candidateId);
  if (cached) return cached;

  return singleFlightPoster(`candidate-cover:${candidateId}`, async () => {
    const again = getCachedCandidateCoverPoster(candidateId);
    if (again) return again;

    return withPosterGenerationSlot(async () => {
      const video = await findFirstReviewFolderVideo(drive, folderId);
      if (!video) return null;

      const jpeg = await withDriveRetry(() =>
        extractDriveVideoPosterJpeg(drive, video.fileId, {
          mimeType: video.mimeType,
          name: video.name,
          maxWidth: 400,
        }),
      );

      if (jpeg && jpeg.length > 0) {
        setCachedCandidateCoverPoster(candidateId, jpeg);
        return jpeg;
      }
      return null;
    });
  });
}
