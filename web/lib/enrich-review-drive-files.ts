import type { drive_v3 } from 'googleapis';

import { getDriveFileThumbnailLink } from '@fr94/review-folder-thumbnail';

import { isVideoMime, reviewDriveVideoPosterUrl } from '@/lib/review-drive-poster-url';

import type { ReviewDriveFile } from '@/app/content/review/types';

/** Backfill missing Drive thumbs (per-file get) and poster URLs for videos. */
export async function enrichReviewDriveFiles(
  drive: drive_v3.Drive,
  files: ReviewDriveFile[],
  candidateId: string,
): Promise<ReviewDriveFile[]> {
  const out: ReviewDriveFile[] = [];

  for (const f of files) {
    let thumbnailLink = f.thumbnailLink;
    if (!thumbnailLink?.trim()) {
      thumbnailLink = await getDriveFileThumbnailLink(drive, f.id);
    }

    let posterUrl: string | null = null;
    if (isVideoMime(f.mimeType) && !thumbnailLink?.trim()) {
      posterUrl = reviewDriveVideoPosterUrl(f.id, candidateId);
    }

    out.push({
      ...f,
      thumbnailLink: thumbnailLink ?? null,
      posterUrl,
    });
  }

  return out;
}
