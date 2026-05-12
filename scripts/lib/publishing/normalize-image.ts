import heicConvert from 'heic-convert';
import sharp from 'sharp';

const MAX_FEED_WIDTH = 1440;
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_ASPECT = 4 / 5;
const MAX_ASPECT = 1.91;

function isHeicMime(m: string | null | undefined): boolean {
  const x = (m ?? '').toLowerCase();
  return x === 'image/heic' || x === 'image/heif';
}

async function heicToJpegBuffer(buf: Buffer): Promise<Buffer> {
  const out = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 });
  if (!out?.length) throw new Error('HEIC/HEIF conversion returned empty buffer');
  return Buffer.from(out);
}

async function ensureFeedAspect(img: sharp.Sharp): Promise<sharp.Sharp> {
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return img;
  const r = w / h;
  if (r >= MIN_ASPECT && r <= MAX_ASPECT) return img;
  if (r < MIN_ASPECT) {
    const targetW = Math.ceil(h * MIN_ASPECT);
    const pad = Math.max(0, Math.floor((targetW - w) / 2));
    const right = Math.max(0, targetW - w - pad);
    return img.extend({ left: pad, right, background: '#ffffff' });
  }
  const targetH = Math.ceil(w / MAX_ASPECT);
  const pad = Math.max(0, Math.floor((targetH - h) / 2));
  const bottom = Math.max(0, targetH - h - pad);
  return img.extend({ top: pad, bottom, background: '#ffffff' });
}

export type NormalizedImage = {
  buffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
};

/**
 * Instagram Content Publishing: JPEG only (no PNG/WebP for containers).
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
  img = await ensureFeedAspect(img);

  const metaAfterAspect = await img.metadata();
  let w = metaAfterAspect.width ?? 0;

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
