import { normalizeAssetId } from './prune-candidate-structure-for-asset';

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function slideByAssetId(carousel_slides: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(carousel_slides)) return map;
  for (const raw of carousel_slides) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const aid = normalizeAssetId(row.asset_id);
    if (!aid) continue;
    map.set(aid.toLowerCase(), row);
  }
  return map;
}

/** Reorder carousel slides by asset id list; preserve headline/body per asset. */
export function reorderCandidateCarouselSlides(params: {
  source_asset_ids: unknown;
  carousel_slides: unknown;
  orderedAssetIds: string[];
}): { carousel_slides: unknown[] } | { error: string } {
  const sourceIds = normalizeStringArray(params.source_asset_ids);
  const ordered = params.orderedAssetIds.map((id) => id.trim()).filter(Boolean);

  if (sourceIds.length === 0) {
    return { error: 'Candidate has no source assets' };
  }
  if (ordered.length !== sourceIds.length) {
    return { error: 'Ordered asset list must include every slide exactly once' };
  }

  const sourceSet = new Set(sourceIds.map((id) => id.toLowerCase()));
  const seen = new Set<string>();
  for (const id of ordered) {
    const key = id.toLowerCase();
    if (!sourceSet.has(key)) {
      return { error: `Unknown asset id: ${id}` };
    }
    if (seen.has(key)) {
      return { error: 'Duplicate asset id in order list' };
    }
    seen.add(key);
  }
  if (seen.size !== sourceSet.size) {
    return { error: 'Ordered asset list must include every slide exactly once' };
  }

  const byAsset = slideByAssetId(params.carousel_slides);
  const next = ordered.map((assetId, i) => {
    const prev = byAsset.get(assetId.toLowerCase());
    const headline = typeof prev?.headline === 'string' ? prev.headline : '';
    const body = typeof prev?.body === 'string' ? prev.body : '';
    return {
      slide: i + 1,
      asset_id: assetId,
      headline,
      body,
    };
  });

  return { carousel_slides: next };
}

export function orderedCarouselAssetIds(
  source_asset_ids: unknown,
  carousel_slides: unknown,
): string[] {
  const sourceIds = normalizeStringArray(source_asset_ids);
  if (sourceIds.length === 0) return [];

  if (Array.isArray(carousel_slides) && carousel_slides.length > 0) {
    const rows = [...carousel_slides] as Record<string, unknown>[];
    rows.sort((a, b) => {
      const sa = typeof a.slide === 'number' ? a.slide : Number.parseInt(String(a.slide ?? '0'), 10);
      const sb = typeof b.slide === 'number' ? b.slide : Number.parseInt(String(b.slide ?? '0'), 10);
      return (Number.isFinite(sa) ? sa : 0) - (Number.isFinite(sb) ? sb : 0);
    });
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const aid = normalizeAssetId(row.asset_id);
      if (!aid || seen.has(aid.toLowerCase())) continue;
      seen.add(aid.toLowerCase());
      out.push(aid);
    }
    for (const id of sourceIds) {
      if (!seen.has(id.toLowerCase())) out.push(id);
    }
    return out;
  }

  return [...sourceIds];
}

export function moveCarouselAssetId(
  orderedIds: string[],
  index: number,
  direction: 'left' | 'right',
): string[] | { error: string } {
  if (index < 0 || index >= orderedIds.length) {
    return { error: 'Invalid slide index' };
  }
  const target = direction === 'left' ? index - 1 : index + 1;
  if (target < 0 || target >= orderedIds.length) {
    return orderedIds;
  }
  const next = [...orderedIds];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
