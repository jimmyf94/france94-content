import sharp from 'sharp';

import { sizedDriveThumbnail } from '@/lib/drive-thumbnail';

const JPEG_QUALITY = 82;

/** Fetch a Drive CDN thumbnail and normalize to a JPEG poster buffer. */
export async function fetchDriveThumbnailJpeg(
  thumbnailLink: string | null | undefined,
  maxWidth = 800,
): Promise<Buffer | null> {
  const url = sizedDriveThumbnail(thumbnailLink, maxWidth);
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length === 0) return null;

    const jpeg = await sharp(raw)
      .rotate()
      .resize({
        width: maxWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    return jpeg.length > 0 ? jpeg : null;
  } catch {
    return null;
  }
}
