import { normalizeAssetId } from './prune-candidate-structure-for-asset';

export type AppendCarouselAssetInput = {
  id: string;
  driveFileId: string;
};

export type AppendCarouselAssetsResult = {
  source_asset_ids: string[];
  source_drive_file_ids: string[];
  carousel_slides: unknown[];
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

export function appendCarouselAssets(params: {
  source_asset_ids: unknown;
  source_drive_file_ids: unknown;
  carousel_slides: unknown;
  newAssets: AppendCarouselAssetInput[];
  maxSlides?: number;
}): AppendCarouselAssetsResult | { error: string } {
  const maxSlides = params.maxSlides ?? 10;
  const existingAssetIds = normalizeStringArray(params.source_asset_ids);
  const existingDriveIds = normalizeStringArray(params.source_drive_file_ids);
  const slides = Array.isArray(params.carousel_slides)
    ? [...params.carousel_slides]
    : [];

  if (params.newAssets.length === 0) {
    return { error: 'No assets to add' };
  }

  if (existingAssetIds.length + params.newAssets.length > maxSlides) {
    return {
      error: `Carousel exceeds Instagram item limit (${maxSlides}).`,
    };
  }

  const attached = new Set(existingAssetIds.map((id) => id.toLowerCase()));
  for (const asset of params.newAssets) {
    const id = asset.id.trim();
    if (!id) return { error: 'Invalid asset id' };
    if (attached.has(id.toLowerCase())) {
      return { error: 'Asset is already attached to this candidate' };
    }
    attached.add(id.toLowerCase());
  }

  const nextAssetIds = [...existingAssetIds];
  const nextDriveIds = [...existingDriveIds];
  const nextSlides = [...slides];

  for (const asset of params.newAssets) {
    nextAssetIds.push(asset.id.trim());
    nextDriveIds.push(asset.driveFileId.trim());
    nextSlides.push({
      slide: nextSlides.length + 1,
      headline: '',
      body: '',
      asset_id: asset.id.trim(),
    });
  }

  const renumbered = nextSlides.map((raw, i) => {
    const base = (raw ?? {}) as Record<string, unknown>;
    const aid = normalizeAssetId(base.asset_id);
    return {
      ...base,
      slide: i + 1,
      ...(aid ? { asset_id: aid } : {}),
    };
  });

  return {
    source_asset_ids: nextAssetIds,
    source_drive_file_ids: nextDriveIds,
    carousel_slides: renumbered,
  };
}
