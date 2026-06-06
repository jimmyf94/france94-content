import type { SupabaseClient } from '@supabase/supabase-js';

import { assetStoredThumbnailUrl } from '@/lib/asset-thumbnail-storage';

export type CandidateSourceRefs = {
  candidateId: string;
  sourceAssetIds: string[];
  sourceDriveFileIds: string[];
};

function normalizeIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function loadThumbnailMaps(
  supabase: SupabaseClient,
  assetIds: string[],
  driveFileIds: string[],
): Promise<{
  byAssetId: Map<string, string>;
  byDriveFileId: Map<string, string>;
}> {
  const byAssetId = new Map<string, string>();
  const byDriveFileId = new Map<string, string>();

  if (assetIds.length > 0) {
    const { data, error } = await supabase
      .from('content_assets')
      .select('id, drive_file_id, thumbnail_path')
      .in('id', assetIds)
      .not('thumbnail_path', 'is', null);

    if (error) {
      console.warn('[cover-from-assets] by id', error.message);
    } else {
      for (const row of data ?? []) {
        const assetId = (row.id as string | null)?.trim();
        const path = (row.thumbnail_path as string | null)?.trim();
        const driveId = (row.drive_file_id as string | null)?.trim();
        if (!assetId || !path) continue;
        const url = assetStoredThumbnailUrl(assetId);
        byAssetId.set(assetId, url);
        if (driveId) byDriveFileId.set(driveId, url);
      }
    }
  }

  const missingDriveIds = driveFileIds.filter((d) => !byDriveFileId.has(d));
  if (missingDriveIds.length > 0) {
    const { data, error } = await supabase
      .from('content_assets')
      .select('id, drive_file_id, thumbnail_path')
      .in('drive_file_id', missingDriveIds)
      .not('thumbnail_path', 'is', null);

    if (error) {
      console.warn('[cover-from-assets] by drive_file_id', error.message);
    } else {
      for (const row of data ?? []) {
        const assetId = (row.id as string | null)?.trim();
        const path = (row.thumbnail_path as string | null)?.trim();
        const driveId = (row.drive_file_id as string | null)?.trim();
        if (!driveId || !path || !assetId) continue;
        byDriveFileId.set(driveId, assetStoredThumbnailUrl(assetId));
      }
    }
  }

  return { byAssetId, byDriveFileId };
}

function pickCoverFromMaps(
  sourceAssetIds: string[],
  sourceDriveFileIds: string[],
  byAssetId: Map<string, string>,
  byDriveFileId: Map<string, string>,
): string | null {
  for (const assetId of sourceAssetIds) {
    const url = byAssetId.get(assetId);
    if (url) return url;
  }
  for (const driveId of sourceDriveFileIds) {
    const url = byDriveFileId.get(driveId);
    if (url) return url;
  }
  return null;
}

/**
 * Batch-resolve queue covers from persisted content_assets thumbnails.
 * Prefers source_asset_ids order, then source_drive_file_ids.
 */
export async function buildCandidateCoverThumbnailsFromAssets(
  supabase: SupabaseClient,
  candidates: CandidateSourceRefs[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (candidates.length === 0) return out;

  const allAssetIds = new Set<string>();
  const allDriveIds = new Set<string>();
  for (const c of candidates) {
    out[c.candidateId] = null;
    for (const id of normalizeIds(c.sourceAssetIds)) allAssetIds.add(id);
    for (const id of normalizeIds(c.sourceDriveFileIds)) allDriveIds.add(id);
  }

  const { byAssetId, byDriveFileId } = await loadThumbnailMaps(
    supabase,
    [...allAssetIds],
    [...allDriveIds],
  );

  for (const c of candidates) {
    const assetIds = normalizeIds(c.sourceAssetIds);
    const driveIds = normalizeIds(c.sourceDriveFileIds);
    out[c.candidateId] = pickCoverFromMaps(assetIds, driveIds, byAssetId, byDriveFileId);
  }

  return out;
}

/**
 * Queue cover from one candidate's source assets (first with thumbnail_path).
 */
export async function resolveCoverThumbnailFromCandidateSources(
  supabase: SupabaseClient,
  params: {
    sourceAssetIds?: string[] | null;
    sourceDriveFileIds?: string[] | null;
  },
): Promise<string | null> {
  const sourceAssetIds = Array.isArray(params.sourceAssetIds)
    ? (params.sourceAssetIds as string[])
    : [];
  const sourceDriveFileIds = Array.isArray(params.sourceDriveFileIds)
    ? (params.sourceDriveFileIds as string[])
    : [];

  const assetIds = normalizeIds(sourceAssetIds);
  const driveIds = normalizeIds(sourceDriveFileIds);
  if (assetIds.length === 0 && driveIds.length === 0) return null;

  const { byAssetId, byDriveFileId } = await loadThumbnailMaps(supabase, assetIds, driveIds);
  return pickCoverFromMaps(assetIds, driveIds, byAssetId, byDriveFileId);
}

/** @deprecated Use resolveCoverThumbnailFromCandidateSources */
export async function resolveCoverThumbnailFromSourceAssets(
  supabase: SupabaseClient,
  sourceDriveFileIds: string[],
): Promise<string | null> {
  return resolveCoverThumbnailFromCandidateSources(supabase, {
    sourceDriveFileIds,
  });
}
