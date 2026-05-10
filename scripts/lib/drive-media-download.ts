import type { drive_v3 } from 'googleapis';

/** Fields aligned with ingest listing so refreshed rows match `buildInsertRow` expectations. */
export const DRIVE_FILE_METADATA_FIELDS =
  'id, name, mimeType, size, parents, md5Checksum, createdTime, modifiedTime, webViewLink, kind, spaces, version, imageMediaMetadata(location, time, cameraMake, cameraModel, width, height, rotation)';

export class FileTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

/** Byte cap for Drive media downloads (ingest conversion + analysis). */
export function maxAnalysisFileBytes(): number {
  const mb = envInt('MAX_ANALYSIS_FILE_SIZE_MB', 500);
  return mb * 1024 * 1024;
}

async function streamToBufferWithLimit(stream: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array | string);
    total += buf.length;
    if (total > maxBytes) {
      if ('destroy' in stream && typeof stream.destroy === 'function') {
        stream.destroy();
      }
      throw new FileTooLargeError(
        `Download exceeded MAX_ANALYSIS_FILE_SIZE_MB cap (${maxBytes} bytes)`,
      );
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

export async function fetchDriveFileMedia(
  drive: drive_v3.Drive,
  driveFileId: string,
  maxBytes: number,
): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );

  const stream = res.data as unknown as NodeJS.ReadableStream;
  return streamToBufferWithLimit(stream, maxBytes);
}
