/** Queue cover: one poster per candidate (avoids N parallel ffmpeg jobs in the sidebar). */
export function candidateCoverPosterUrl(candidateId: string): string {
  return `/api/content-review/candidates/${encodeURIComponent(candidateId)}/cover-poster`;
}

/** Viewport tile poster for a specific review-folder video file. */
export function reviewDriveVideoPosterUrl(fileId: string, candidateId: string): string {
  return `/api/content-review/drive-file/${encodeURIComponent(fileId)}/poster?candidateId=${encodeURIComponent(candidateId)}`;
}

/** Stored cover_thumbnail_url values that point at our API should be refreshed. */
export function isApiCoverThumbnailUrl(url: string): boolean {
  const u = url.trim();
  return u.startsWith('/api/content-review/') || u.startsWith('/api/content-assets/');
}

export function isVideoMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('video/');
}
