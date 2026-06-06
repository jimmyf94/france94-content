/** Private Supabase Storage bucket for persisted asset JPEG thumbnails. */

export function assetThumbnailBucketName(): string {
  return process.env.ASSET_THUMBNAIL_BUCKET?.trim() || 'asset-thumbnails';
}

export function assetStoredThumbnailUrl(assetId: string): string {
  return `/api/content-assets/${encodeURIComponent(assetId)}/thumbnail`;
}

export function hasStoredThumbnail(thumbnailPath: string | null | undefined): boolean {
  return Boolean(thumbnailPath?.trim());
}
