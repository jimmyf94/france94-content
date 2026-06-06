import type { drive_v3 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getFirstReviewFolderThumbnailLink } from '@fr94/review-folder-thumbnail';

import { resolveCoverThumbnailFromCandidateSources } from '@/lib/candidate-cover-from-assets';
import { listReviewFolderFiles } from '@/lib/list-review-folder';
import { candidateCoverPosterUrl, isVideoMime } from '@/lib/review-drive-poster-url';

/**
 * Queue cover: Supabase asset thumbnail when available, else Drive thumb, else cover-poster API.
 */
export async function resolveCandidateCoverThumbnail(
  drive: drive_v3.Drive,
  folderId: string,
  candidateId: string,
  fallbackDriveFileIds?: string[],
  supabase?: SupabaseClient | null,
  sourceAssetIds?: string[],
): Promise<string | null> {
  if (supabase) {
    const stored = await resolveCoverThumbnailFromCandidateSources(supabase, {
      sourceAssetIds,
      sourceDriveFileIds: fallbackDriveFileIds,
    });
    if (stored) return stored;
  }

  const driveThumb = await getFirstReviewFolderThumbnailLink(drive, folderId, {
    fallbackDriveFileIds,
  });
  if (driveThumb) return driveThumb;

  const files = await listReviewFolderFiles(drive, folderId);
  const hasVideo = files.some((f) => f.id && isVideoMime(f.mimeType ?? ''));
  if (hasVideo) {
    return candidateCoverPosterUrl(candidateId);
  }

  return null;
}
