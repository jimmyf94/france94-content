import type { ReviewDriveFile } from '@/app/content/review/types';

import { normalizeAssetId } from './prune-candidate-structure-for-asset';
import { orderedCarouselAssetIds } from './reorder-candidate-carousel-slides';

export type CarouselPublishOrderRow = {
  slide: number;
  assetId: string;
  label: string;
  headline: string;
  body: string;
};

function slideMetaByAssetId(carousel_slides: unknown): Map<string, { headline: string; body: string }> {
  const map = new Map<string, { headline: string; body: string }>();
  if (!Array.isArray(carousel_slides)) return map;
  for (const raw of carousel_slides) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const aid = normalizeAssetId(row.asset_id);
    if (!aid) continue;
    map.set(aid.toLowerCase(), {
      headline: typeof row.headline === 'string' ? row.headline.trim() : '',
      body: typeof row.body === 'string' ? row.body.trim() : '',
    });
  }
  return map;
}

function buildAssetLabelMap(
  source_asset_ids: unknown,
  mediaFiles: ReviewDriveFile[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  const sourceIds = Array.isArray(source_asset_ids)
    ? source_asset_ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  for (const file of mediaFiles ?? []) {
    const aid = file.sourceAssetId?.trim();
    const name = file.name?.trim();
    if (aid && name) map.set(aid.toLowerCase(), name);
  }

  for (let i = 0; i < sourceIds.length; i++) {
    const aid = sourceIds[i]!;
    const key = aid.toLowerCase();
    if (map.has(key)) continue;
    const file = mediaFiles?.[i];
    if (file?.name?.trim()) {
      map.set(key, file.name.trim());
    }
  }

  return map;
}

export function buildCarouselPublishOrderRows(params: {
  source_asset_ids: unknown;
  carousel_slides: unknown;
  mediaFiles?: ReviewDriveFile[];
}): CarouselPublishOrderRow[] {
  const assetIds = orderedCarouselAssetIds(params.source_asset_ids, params.carousel_slides);
  const meta = slideMetaByAssetId(params.carousel_slides);
  const labels = buildAssetLabelMap(params.source_asset_ids, params.mediaFiles);

  return assetIds.map((assetId, i) => {
    const key = assetId.toLowerCase();
    const m = meta.get(key);
    return {
      slide: i + 1,
      assetId,
      label: labels.get(key) ?? 'Unknown asset',
      headline: m?.headline ?? '',
      body: m?.body ?? '',
    };
  });
}
