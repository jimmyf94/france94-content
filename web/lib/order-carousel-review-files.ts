import type { ReviewDriveFile } from '@/app/content/review/types';

import { orderedCarouselAssetIds } from './reorder-candidate-carousel-slides';
import {
  resolveReviewFolderFileSourceIndex,
  type AssetNameRow,
} from './review-folder-asset-match';

export type ReviewFileWithAsset = ReviewDriveFile & {
  sourceAssetId: string | null;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/** Attach source asset id and sort review files by carousel publish order. */
export function orderCarouselReviewFiles(params: {
  files: ReviewDriveFile[];
  source_asset_ids: unknown;
  source_drive_file_ids: unknown;
  carousel_slides: unknown;
  assetRows: AssetNameRow[];
  liveProcessedDriveFileNames?: string[] | null;
}): ReviewFileWithAsset[] {
  const sourceAssetIds = normalizeStringArray(params.source_asset_ids);
  const sourceDriveIds = normalizeStringArray(params.source_drive_file_ids);
  const orderIds = orderedCarouselAssetIds(sourceAssetIds, params.carousel_slides);

  const withAsset: ReviewFileWithAsset[] = params.files.map((file) => {
    const idx = resolveReviewFolderFileSourceIndex(
      file.id,
      file.name,
      sourceAssetIds,
      sourceDriveIds,
      params.assetRows,
      params.liveProcessedDriveFileNames ?? null,
    );
    const sourceAssetId = idx >= 0 ? (sourceAssetIds[idx] ?? null) : null;
    return { ...file, sourceAssetId };
  });

  if (orderIds.length === 0) return withAsset;

  const byAssetId = new Map<string, ReviewFileWithAsset>();
  const unmatched: ReviewFileWithAsset[] = [];
  for (const file of withAsset) {
    const id = file.sourceAssetId?.trim().toLowerCase();
    if (id && !byAssetId.has(id)) {
      byAssetId.set(id, file);
    } else {
      unmatched.push(file);
    }
  }

  const ordered: ReviewFileWithAsset[] = [];
  for (const assetId of orderIds) {
    const hit = byAssetId.get(assetId.toLowerCase());
    if (hit) ordered.push(hit);
  }
  for (const file of withAsset) {
    if (!ordered.includes(file)) ordered.push(file);
  }
  return ordered;
}
