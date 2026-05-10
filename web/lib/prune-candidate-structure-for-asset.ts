/**
 * When a source asset is removed from a post candidate, drop matching
 * carousel_slides / story_frames rows and renumber slide/frame (1..n).
 */

export function normalizeAssetId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function pruneStructureRows(
  rows: unknown[],
  removedId: string,
  removedIndex: number,
  sourceLen: number,
  orderKey: 'slide' | 'frame',
): unknown[] {
  const normRemoved = removedId.trim().toLowerCase();

  let next = rows.filter((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const aid = normalizeAssetId(r.asset_id);
    if (aid === null) return true;
    return aid.toLowerCase() !== normRemoved;
  });

  if (
    next.length === rows.length &&
    rows.length === sourceLen &&
    removedIndex >= 0 &&
    removedIndex < rows.length
  ) {
    next = rows.filter((_, i) => i !== removedIndex);
  }

  return next.map((raw, i) => {
    const base = (raw ?? {}) as Record<string, unknown>;
    return { ...base, [orderKey]: i + 1 };
  });
}

export function pruneCarouselSlides(
  slides: unknown[],
  removedId: string,
  removedIndex: number,
  sourceLen: number,
): unknown[] {
  return pruneStructureRows(slides, removedId, removedIndex, sourceLen, 'slide');
}

export function pruneStoryFrames(
  frames: unknown[],
  removedId: string,
  removedIndex: number,
  sourceLen: number,
): unknown[] {
  return pruneStructureRows(frames, removedId, removedIndex, sourceLen, 'frame');
}

export function pruneCandidateStructureForRemovedAsset(params: {
  postType: string | null | undefined;
  story_frames: unknown;
  carousel_slides: unknown;
  removedAssetId: string;
  removedIndex: number;
  sourceAssetIdsLen: number;
}): { story_frames?: unknown; carousel_slides?: unknown } {
  const {
    postType,
    story_frames,
    carousel_slides,
    removedAssetId,
    removedIndex,
    sourceAssetIdsLen,
  } = params;

  const out: { story_frames?: unknown; carousel_slides?: unknown } = {};

  if (postType === 'carousel' && Array.isArray(carousel_slides)) {
    const next = pruneCarouselSlides(
      carousel_slides,
      removedAssetId,
      removedIndex,
      sourceAssetIdsLen,
    );
    if (JSON.stringify(next) !== JSON.stringify(carousel_slides)) {
      out.carousel_slides = next;
    }
  }

  if (postType === 'story_sequence' && Array.isArray(story_frames)) {
    const next = pruneStoryFrames(
      story_frames,
      removedAssetId,
      removedIndex,
      sourceAssetIdsLen,
    );
    if (JSON.stringify(next) !== JSON.stringify(story_frames)) {
      out.story_frames = next;
    }
  }

  return out;
}
