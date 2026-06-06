/** Same-origin media URLs for asset library grid thumbnails. */

export function assetStoredThumbnailUrl(assetId: string): string {
  return `/api/content-assets/${encodeURIComponent(assetId)}/thumbnail`;
}

export function assetVideoPosterUrl(assetId: string): string {
  return `/api/content-assets/${encodeURIComponent(assetId)}/poster`;
}

export function assetImageStillUrl(assetId: string): string {
  return `/api/content-assets/${encodeURIComponent(assetId)}/thumb`;
}

export function isVideoMime(mimeType: string | null | undefined): boolean {
  return (mimeType ?? '').toLowerCase().startsWith('video/');
}

export function isImageMime(mimeType: string | null | undefined): boolean {
  return (mimeType ?? '').toLowerCase().startsWith('image/');
}
