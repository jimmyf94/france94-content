/** Request a Drive thumbnail at a given max width (Google CDN `=wN` suffix). */
export function sizedDriveThumbnail(
  url: string | null | undefined,
  width = 800,
): string | null {
  if (!url) return null;
  const base = url.replace(/=s\d+$/i, '').replace(/=w\d+(-h\d+)?$/i, '');
  return `${base}=w${width}`;
}
