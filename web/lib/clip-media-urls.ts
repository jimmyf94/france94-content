/** Same-origin media URLs for clip picker thumbnails. */

export function clipStoredThumbnailUrl(clipId: string): string {
  return `/api/content-review/clips/${encodeURIComponent(clipId)}/thumbnail`;
}

export function clipAssetFallbackThumbnailUrl(assetId: string): string {
  return `/api/content-assets/${encodeURIComponent(assetId)}/thumbnail`;
}
