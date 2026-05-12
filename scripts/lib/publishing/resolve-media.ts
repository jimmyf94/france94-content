import type { SupabaseClient } from '@supabase/supabase-js';

import { inferMediaType } from '../../ingest-drive-content.js';

import type { PostCandidateRow, ResolvedMediaItem } from './types.js';

type AssetRow = {
  id: string;
  drive_file_id: string;
  mime_type: string | null;
  media_type: string | null;
};

function slideOrder(a: Record<string, unknown>): number {
  for (const key of ['slide', 'frame', 'index']) {
    const s = a[key];
    if (typeof s === 'number' && Number.isFinite(s)) return s;
    if (typeof s === 'string' && /^\d+$/.test(s)) return Number.parseInt(s, 10);
  }
  return 0;
}

/**
 * Build an asset_id → sort-order map from jsonb slide/frame arrays.
 * Returns null when the jsonb doesn't provide usable ordering.
 */
function jsonbOrderMap(
  postType: string,
  carouselSlides: unknown,
  storyFrames: unknown,
): Map<string, number> | null {
  let items: Record<string, unknown>[] | null = null;

  if (postType === 'carousel' && Array.isArray(carouselSlides) && carouselSlides.length > 0) {
    items = [...carouselSlides] as Record<string, unknown>[];
  } else if (postType === 'story_sequence' && Array.isArray(storyFrames) && storyFrames.length > 0) {
    items = [...storyFrames] as Record<string, unknown>[];
  }

  if (!items) return null;

  items.sort((x, y) => slideOrder(x) - slideOrder(y));
  const map = new Map<string, number>();
  let idx = 0;
  for (const item of items) {
    const id = typeof item.asset_id === 'string' ? item.asset_id.trim() : '';
    if (/^[0-9a-f-]{36}$/i.test(id) && !map.has(id)) {
      map.set(id, idx++);
    }
  }
  return map.size > 0 ? map : null;
}

/**
 * Resolve source_asset_ids into full media items via content_assets.
 * Always uses source_asset_ids as the canonical list; applies presentation
 * ordering from carousel_slides / story_frames when available.
 */
export async function resolveCandidateMedia(
  supabase: SupabaseClient,
  candidate: PostCandidateRow,
): Promise<ResolvedMediaItem[]> {
  const rawIds = candidate.source_asset_ids ?? [];
  const validIds: string[] = [];
  for (const id of rawIds) {
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id.trim())) {
      validIds.push(id.trim());
    }
  }

  if (validIds.length === 0) return [];

  const orderMap = jsonbOrderMap(
    candidate.post_type,
    candidate.carousel_slides,
    candidate.story_frames,
  );

  if (orderMap) {
    validIds.sort((a, b) => {
      const oa = orderMap.get(a) ?? Number.MAX_SAFE_INTEGER;
      const ob = orderMap.get(b) ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }

  const uniqueIds = [...new Set(validIds)];
  const { data: rows, error } = await supabase
    .from('content_assets')
    .select('id, drive_file_id, mime_type, media_type')
    .in('id', uniqueIds);

  if (error) throw new Error(error.message);

  const byId = new Map<string, AssetRow>();
  for (const r of rows ?? []) {
    byId.set(r.id, r as AssetRow);
  }

  const out: ResolvedMediaItem[] = [];
  let order = 0;
  for (const assetId of validIds) {
    const row = byId.get(assetId);
    if (!row?.drive_file_id) continue;
    const mime = row.mime_type;
    const mt = row.media_type?.trim() || inferMediaType(mime);
    order += 1;
    out.push({
      order,
      asset_id: assetId,
      drive_file_id: row.drive_file_id,
      mime_type: mime,
      media_type: mt,
    });
  }

  return out;
}
