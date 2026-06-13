import type { drive_v3 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ReviewDriveFile } from '@/app/content/review/types';
import { assetStoredThumbnailUrl, assetVideoPosterUrl } from '@/lib/asset-media-urls';
import { extractCandidateSourceRefs } from '@/lib/candidate-drive-file-access';
import { getDriveFileThumbnailLink } from '@fr94/review-folder-thumbnail';
import { isVideoMime } from '@/lib/review-drive-poster-url';

type AssetRow = {
  id: string;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  original_filename: string | null;
  current_filename: string | null;
  final_filename: string | null;
  mime_type: string | null;
  media_type: string | null;
  thumbnail_path: string | null;
};

const DRIVE_META_FIELDS =
  'id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, thumbnailLink';

function assetDisplayName(row: AssetRow): string {
  return (
    row.final_filename?.trim() ||
    row.current_filename?.trim() ||
    row.original_filename?.trim() ||
    row.drive_file_id?.trim() ||
    row.id
  );
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

/**
 * List review UI media from candidate source assets when no Drive review folder exists
 * (clip-based reel candidates).
 */
export async function listCandidateSourceReviewFiles(
  supabase: SupabaseClient,
  drive: drive_v3.Drive,
  row: {
    source_asset_ids?: unknown;
    source_drive_file_ids?: unknown;
    reel_instructions?: unknown;
  },
): Promise<ReviewDriveFile[]> {
  const { sourceAssetIds, sourceDriveFileIds } = extractCandidateSourceRefs(row);
  if (sourceAssetIds.length === 0 && sourceDriveFileIds.length === 0) return [];

  const assetById = new Map<string, AssetRow>();
  if (sourceAssetIds.length > 0) {
    const { data, error } = await supabase
      .from('content_assets')
      .select(
        'id, drive_file_id, drive_web_view_link, original_filename, current_filename, final_filename, mime_type, media_type, thumbnail_path',
      )
      .in('id', sourceAssetIds);

    if (error) {
      console.warn('[candidate-source-files] by id', error.message);
    } else {
      for (const row of data ?? []) {
        assetById.set(row.id as string, row as AssetRow);
      }
    }
  }

  const missingDriveIds = sourceDriveFileIds.filter(
    (driveId) => !sourceAssetIds.some((aid) => assetById.get(aid)?.drive_file_id?.trim() === driveId),
  );
  if (missingDriveIds.length > 0) {
    const { data, error } = await supabase
      .from('content_assets')
      .select(
        'id, drive_file_id, drive_web_view_link, original_filename, current_filename, final_filename, mime_type, media_type, thumbnail_path',
      )
      .in('drive_file_id', missingDriveIds);

    if (error) {
      console.warn('[candidate-source-files] by drive_file_id', error.message);
    } else {
      for (const row of data ?? []) {
        const id = row.id as string;
        if (!assetById.has(id)) assetById.set(id, row as AssetRow);
      }
    }
  }

  const orderedAssets: AssetRow[] = [];
  const seenAssetIds = new Set<string>();
  for (const assetId of sourceAssetIds) {
    const row = assetById.get(assetId);
    if (!row || seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    orderedAssets.push(row);
  }

  for (const driveId of sourceDriveFileIds) {
    const row = [...assetById.values()].find((a) => a.drive_file_id?.trim() === driveId);
    if (!row || seenAssetIds.has(row.id)) continue;
    seenAssetIds.add(row.id);
    orderedAssets.push(row);
  }

  const withDrive = orderedAssets.filter((a) => a.drive_file_id?.trim());
  if (withDrive.length === 0) return [];

  const driveMeta = await mapWithConcurrency(withDrive, 4, async (asset) => {
    const fileId = asset.drive_file_id!.trim();
    try {
      const res = await drive.files.get({
        fileId,
        fields: DRIVE_META_FIELDS,
        supportsAllDrives: true,
      });
      return { asset, meta: res.data };
    } catch (e) {
      console.warn('[candidate-source-files] drive get', fileId, e);
      return { asset, meta: null };
    }
  });

  const out: ReviewDriveFile[] = [];

  for (const { asset, meta } of driveMeta) {
    const fileId = asset.drive_file_id!.trim();
    const mimeType =
      meta?.mimeType?.trim() ||
      asset.mime_type?.trim() ||
      (asset.media_type?.trim() === 'video' ? 'video/mp4' : 'application/octet-stream');

    let thumbnailLink: string | null = meta?.thumbnailLink ?? null;
    if (!thumbnailLink?.trim()) {
      thumbnailLink = await getDriveFileThumbnailLink(drive, fileId);
    }
    if (asset.thumbnail_path?.trim()) {
      thumbnailLink = assetStoredThumbnailUrl(asset.id);
    }

    let posterUrl: string | null = null;
    if (isVideoMime(mimeType)) {
      posterUrl = assetVideoPosterUrl(asset.id);
    }

    out.push({
      id: fileId,
      name: meta?.name?.trim() || assetDisplayName(asset),
      mimeType,
      thumbnailLink,
      posterUrl,
      webViewLink: asset.drive_web_view_link?.trim() || (meta?.webViewLink ?? null),
      webContentLink: meta?.webContentLink ?? null,
      size: meta?.size ?? null,
      createdTime: meta?.createdTime ?? null,
      modifiedTime: meta?.modifiedTime ?? null,
    });
  }

  return out;
}
