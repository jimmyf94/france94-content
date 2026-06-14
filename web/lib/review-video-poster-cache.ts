import type { drive_v3 } from 'googleapis';

import { getDriveFileThumbnailLink } from '@fr94/review-folder-thumbnail';
import { extractDriveVideoPosterJpeg } from '@fr94/drive-video-poster';

import { fetchDriveThumbnailJpeg } from '@/lib/fetch-drive-thumbnail-jpeg';
import {
  singleFlightPoster,
  withDriveRetry,
  withPosterGenerationSlot,
} from '@/lib/poster-generation-limiter';
import { isVideoMime } from '@/lib/review-drive-poster-url';

import type { ReviewDriveFile } from '@/app/content/review/types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type CacheEntry = { jpeg: Buffer; at: number };

const posterCache = new Map<string, CacheEntry>();

export function reviewPosterCacheKey(candidateId: string, fileId: string): string {
  return `${candidateId}:${fileId}`;
}

export function getCachedReviewPoster(candidateId: string, fileId: string): Buffer | null {
  const key = reviewPosterCacheKey(candidateId, fileId);
  const hit = posterCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    posterCache.delete(key);
    return null;
  }
  return hit.jpeg;
}

function setCachedReviewPoster(candidateId: string, fileId: string, jpeg: Buffer): void {
  if (posterCache.size >= MAX_ENTRIES) {
    const oldest = posterCache.keys().next().value;
    if (oldest) posterCache.delete(oldest);
  }
  posterCache.set(reviewPosterCacheKey(candidateId, fileId), { jpeg, at: Date.now() });
}

export async function generateReviewVideoPoster(
  drive: drive_v3.Drive,
  candidateId: string,
  fileId: string,
  params: { mimeType: string; name?: string | null; thumbnailLink?: string | null },
): Promise<Buffer | null> {
  const cached = getCachedReviewPoster(candidateId, fileId);
  if (cached) return cached;

  return singleFlightPoster(`review:${candidateId}:${fileId}`, async () => {
    const again = getCachedReviewPoster(candidateId, fileId);
    if (again) return again;

    const jpeg = await withPosterGenerationSlot(async () => {
      let thumbLink = params.thumbnailLink?.trim() || null;
      if (!thumbLink) {
        thumbLink = await withDriveRetry(() => getDriveFileThumbnailLink(drive, fileId));
      }

      if (thumbLink) {
        const fromDrive = await fetchDriveThumbnailJpeg(thumbLink, 800);
        if (fromDrive && fromDrive.length > 0) {
          setCachedReviewPoster(candidateId, fileId, fromDrive);
          return fromDrive;
        }
      }

      return withDriveRetry(() =>
        extractDriveVideoPosterJpeg(drive, fileId, {
          mimeType: params.mimeType,
          name: params.name,
          maxWidth: 800,
        }),
      );
    });

    if (jpeg && jpeg.length > 0) {
      setCachedReviewPoster(candidateId, fileId, jpeg);
      return jpeg;
    }

    return null;
  });
}

const MAX_WARM_VIEWPORT_VIDEOS = 1;

/** Warm at most one viewport video poster (selected candidate) to avoid Drive 429 storms. */
export function warmReviewVideoPosters(
  drive: drive_v3.Drive,
  files: ReviewDriveFile[],
  candidateId: string,
  folderId: string,
): void {
  let warmed = 0;
  for (const f of files) {
    if (warmed >= MAX_WARM_VIEWPORT_VIDEOS) break;
    if (!f.id || !isVideoMime(f.mimeType)) continue;
    if (f.thumbnailLink?.trim()) continue;
    if (getCachedReviewPoster(candidateId, f.id)) continue;
    warmed += 1;

    void (async () => {
      try {
        const meta = await withDriveRetry(() =>
          drive.files.get({
            fileId: f.id,
            fields: 'parents, mimeType, name, thumbnailLink',
            supportsAllDrives: true,
          }),
        );
        const parents = meta.data.parents ?? [];
        if (!parents.includes(folderId)) return;

        await generateReviewVideoPoster(drive, candidateId, f.id, {
          mimeType: meta.data.mimeType ?? f.mimeType,
          name: meta.data.name ?? f.name,
          thumbnailLink: meta.data.thumbnailLink ?? f.thumbnailLink,
        });
      } catch {
        /* best-effort warm */
      }
    })();
  }
}
