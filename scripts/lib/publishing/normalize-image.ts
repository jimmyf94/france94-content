import heicConvert from 'heic-convert';
import sharp from 'sharp';

const MAX_FEED_WIDTH = 1440;
const MAX_BYTES = 8 * 1024 * 1024;

function isHeicMime(m: string | null | undefined): boolean {
  const x = (m ?? '').toLowerCase();
  return x === 'image/heic' || x === 'image/heif';
}

async function heicToJpegBuffer(buf: Buffer): Promise<Buffer> {
  const out = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 });
  if (!out?.length) throw new Error('HEIC/HEIF conversion returned empty buffer');
  return Buffer.from(out);
}

export type NormalizedImage = {
  buffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
};

/**
 * Instagram Content Publishing: JPEG only (no PNG/WebP for containers).
 * Preserves source aspect ratio — Instagram handles feed/story display cropping.
 * Alpha is flattened onto white so carousel and feed image_urls are always image/jpeg.
 * @see https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
export async function normalizeImageForInstagram(params: {
  buffer: Buffer;
  mimeType: string | null;
}): Promise<NormalizedImage> {
  let buf = params.buffer;
  if (isHeicMime(params.mimeType)) {
    buf = await heicToJpegBuffer(buf);
  }

  let img = sharp(buf).rotate();

  const meta = await img.metadata();
  let w = meta.width ?? 0;

  if (w > MAX_FEED_WIDTH) {
    img = img.resize({
      width: MAX_FEED_WIDTH,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const flattened = img.flatten({ background: '#ffffff' });

  let quality = 87;
  let jpeg = await flattened.jpeg({ quality, mozjpeg: true }).toBuffer();
  while (jpeg.length > MAX_BYTES && quality > 55) {
    quality -= 6;
    jpeg = await img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  if (jpeg.length > MAX_BYTES) {
    jpeg = await img
      .flatten({ background: '#ffffff' })
      .resize({ width: Math.floor(MAX_FEED_WIDTH * 0.85), fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
  }

  if (jpeg.length > MAX_BYTES) {
    throw new Error(`JPEG still exceeds Instagram 8MB limit (${jpeg.length} bytes)`);
  }

  const dim = await sharp(jpeg).metadata();
  return {
    buffer: jpeg,
    mimeType: 'image/jpeg',
    width: dim.width ?? null,
    height: dim.height ?? null,
  };
}
