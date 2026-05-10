/**
 * HEIC/HEIF → JPEG normalization for Google Drive ingest (Linux/cloud friendly).
 *
 * 1) `heic-convert` (npm) — pure Node, works on Cloud Run / cron without macOS.
 * 2) `heif-convert` CLI — optional; e.g. Debian/Ubuntu: libheif-examples.
 * 3) ImageMagick `magick` / `convert` — optional; image with libheif delegate.
 *
 * Deploy: ensure the ingest worker runs on an image with Node + (if needed) libheif/ImageMagick.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { drive_v3 } from 'googleapis';
import heicConvert from 'heic-convert';

import { DRIVE_FILE_METADATA_FIELDS, fetchDriveFileMedia } from './drive-media-download.js';
import { formatGoogleDriveApiError } from './google-drive-auth.js';
import { withTempDir } from './video-preprocess.js';

function fileExtension(filename: string): string | null {
  const i = filename.lastIndexOf('.');
  if (i <= 0 || i === filename.length - 1) return null;
  return filename.slice(i + 1).toLowerCase();
}

export type HeicOriginalFormat = 'heic' | 'heif';

export type IngestDriveFileResolution = {
  file: drive_v3.Schema$File;
  /** Set when the row describes a JPEG converted from HEIC/HEIF */
  original_format: HeicOriginalFormat | null;
  /** When non-null, delete this Drive file after a successful DB insert */
  pendingDeleteDriveFileId: string | null;
};

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function inferHeicFormat(mimeType: string | null | undefined, ext: string | null): HeicOriginalFormat | null {
  const e = ext?.toLowerCase() ?? '';
  if (e === 'heic') return 'heic';
  if (e === 'heif') return 'heif';
  const m = (mimeType ?? '').toLowerCase().trim();
  if (m === 'image/heic') return 'heic';
  if (m === 'image/heif') return 'heif';
  return null;
}

function errBrief(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0]?.slice(0, 240) ?? msg;
}

function runSpawn(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const tail = stderr.trim().split('\n').slice(-10).join('\n');
        reject(new Error(`${path.basename(bin)} exited ${code}: ${tail}`));
      }
    });
  });
}

function heifConvertCandidates(): string[] {
  const out: string[] = [];
  const fromEnv = process.env.HEIF_CONVERT_PATH?.trim();
  if (fromEnv) out.push(fromEnv);
  out.push('heif-convert');
  return [...new Set(out)];
}

function magickCandidates(): string[] {
  const out: string[] = [];
  const fromEnv = process.env.HEIC_MAGICK_PATH?.trim();
  if (fromEnv) out.push(fromEnv);
  out.push('magick', 'convert');
  return [...new Set(out)];
}

async function convertViaHeifConvertCli(
  sourceBuffer: Buffer,
  inputSuffix: HeicOriginalFormat,
): Promise<Buffer> {
  let lastErr: unknown = null;
  for (const bin of heifConvertCandidates()) {
    try {
      return await withTempDir('fr94-heic-', async (dir) => {
        const inPath = path.join(dir, `input.${inputSuffix}`);
        const outPath = path.join(dir, 'output.jpg');
        fs.writeFileSync(inPath, sourceBuffer);
        await runSpawn(bin, [inPath, outPath]);
        const jpegBuffer = fs.readFileSync(outPath);
        if (jpegBuffer.length === 0) throw new Error('empty JPEG');
        return jpegBuffer;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('heif-convert failed');
}

async function convertViaImageMagick(sourceBuffer: Buffer, inputSuffix: HeicOriginalFormat): Promise<Buffer> {
  let lastErr: unknown = null;
  for (const bin of magickCandidates()) {
    try {
      return await withTempDir('fr94-heic-', async (dir) => {
        const inPath = path.join(dir, `input.${inputSuffix}`);
        const outPath = path.join(dir, 'output.jpg');
        fs.writeFileSync(inPath, sourceBuffer);
        await runSpawn(bin, [inPath, '-auto-orient', '-quality', '91', outPath]);
        const jpegBuffer = fs.readFileSync(outPath);
        if (jpegBuffer.length === 0) throw new Error('empty JPEG');
        return jpegBuffer;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('ImageMagick failed');
}

async function heicBufferToJpeg(sourceBuffer: Buffer, originalFormat: HeicOriginalFormat): Promise<Buffer> {
  try {
    const buf = await heicConvert({
      buffer: sourceBuffer,
      format: 'JPEG',
      quality: 0.91,
    });
    if (!buf?.length) throw new Error('heic-convert returned empty buffer');
    console.log('[heic]\tconverted with heic-convert (npm)');
    return buf;
  } catch (e) {
    console.warn(`[heic]\theic-convert failed\t${errBrief(e)}`);
  }

  try {
    const buf = await convertViaHeifConvertCli(sourceBuffer, originalFormat);
    console.log('[heic]\tconverted with heif-convert (CLI)');
    return buf;
  } catch (e) {
    console.warn(`[heic]\theif-convert failed\t${errBrief(e)}`);
  }

  try {
    const buf = await convertViaImageMagick(sourceBuffer, originalFormat);
    console.log('[heic]\tconverted with ImageMagick');
    return buf;
  } catch (e) {
    console.warn(`[heic]\tImageMagick failed\t${errBrief(e)}`);
  }

  throw new Error(
    `HEIC/HEIF conversion failed (${originalFormat}). ` +
      `Install libheif CLI (e.g. HEIF_CONVERT_PATH or apt install libheif-examples) ` +
      `or ImageMagick with HEIC (HEIC_MAGICK_PATH / magick on PATH).`,
  );
}

function stemFilename(filename: string): string {
  const i = filename.lastIndexOf('.');
  if (i <= 0) return filename || 'image';
  return filename.slice(0, i) || 'image';
}

async function driveFileNameExists(
  drive: drive_v3.Drive,
  params: { parentId: string; name: string },
): Promise<boolean> {
  const q =
    `'${escapeDriveQueryLiteral(params.parentId)}' in parents and trashed = false and name = '${escapeDriveQueryLiteral(params.name)}'`;
  const res = await drive.files.list({
    q,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files?.length ?? 0) > 0;
}

async function pickUniqueJpegName(
  drive: drive_v3.Drive,
  parentId: string,
  originalName: string,
): Promise<string> {
  const stem = stemFilename(originalName);
  let candidate = `${stem}.jpg`;
  let n = 2;
  while (await driveFileNameExists(drive, { parentId, name: candidate })) {
    candidate = `${stem}_${n}.jpg`;
    n += 1;
  }
  return candidate;
}

async function safeDeleteDriveFile(drive: drive_v3.Drive, fileId: string, context: string): Promise<void> {
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch (e) {
    console.warn(`[warn] ${context}: failed to delete Drive file ${fileId}: ${formatGoogleDriveApiError(e)}`);
  }
}

/**
 * For HEIC/HEIF: download, convert to JPEG, upload alongside original parent, return new metadata + ids.
 * For other types: return the input file unchanged.
 */
export async function resolveDriveFileForIngest(
  drive: drive_v3.Drive,
  file: drive_v3.Schema$File,
  inboxFolderId: string,
  maxBytes: number,
): Promise<IngestDriveFileResolution> {
  const id = file.id;
  if (!id) {
    throw new Error('Drive file missing id');
  }

  const name = file.name ?? 'unknown';
  const ext = fileExtension(name);
  const originalFormat = inferHeicFormat(file.mimeType ?? null, ext);
  if (originalFormat == null) {
    return { file, original_format: null, pendingDeleteDriveFileId: null };
  }

  const parentId = file.parents?.[0] ?? inboxFolderId;

  console.log(`[heic]\tnormalize\t${name}\t${id}\tformat=${originalFormat}`);

  const sourceBuffer = await fetchDriveFileMedia(drive, id, maxBytes);

  const jpegBuffer = await heicBufferToJpeg(sourceBuffer, originalFormat);

  const outName = await pickUniqueJpegName(drive, parentId, name);

  const created = await drive.files.create({
    requestBody: {
      name: outName,
      parents: [parentId],
      mimeType: 'image/jpeg',
    },
    media: {
      mimeType: 'image/jpeg',
      body: Readable.from(jpegBuffer),
    },
    supportsAllDrives: true,
    fields: DRIVE_FILE_METADATA_FIELDS,
  });

  const newId = created.data.id;
  if (!newId) {
    throw new Error('Drive files.create returned no id for converted JPEG');
  }

  const refreshed = await drive.files.get({
    fileId: newId,
    fields: DRIVE_FILE_METADATA_FIELDS,
    supportsAllDrives: true,
  });

  const newFile = refreshed.data;
  if (!newFile.id) {
    await safeDeleteDriveFile(drive, newId, 'heic normalize missing refreshed id');
    throw new Error('Drive files.get returned no id after JPEG upload');
  }

  return {
    file: newFile,
    original_format: originalFormat,
    pendingDeleteDriveFileId: id,
  };
}

/** Call after a successful Supabase insert for the derivative row. */
export async function finalizeHeicIngest(
  drive: drive_v3.Drive,
  pendingDeleteDriveFileId: string | null,
  uploadedJpegId: string,
): Promise<void> {
  if (!pendingDeleteDriveFileId) return;
  try {
    await drive.files.delete({ fileId: pendingDeleteDriveFileId, supportsAllDrives: true });
    console.log(`[heic]\tdeleted original\t${pendingDeleteDriveFileId}`);
  } catch (e) {
    console.warn(
      `[warn] heic: could not delete original ${pendingDeleteDriveFileId} (JPEG ${uploadedJpegId} kept): ${formatGoogleDriveApiError(e)}`,
    );
  }
}

/** If DB insert fails after upload, remove the orphan JPEG. */
export async function rollbackHeicUpload(drive: drive_v3.Drive, uploadedJpegId: string | null): Promise<void> {
  if (!uploadedJpegId) return;
  await safeDeleteDriveFile(drive, uploadedJpegId, 'heic rollback orphan JPEG');
}
