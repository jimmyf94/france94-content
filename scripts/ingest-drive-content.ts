import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';

import { OAUTH_REDIRECT_URI, loadWebOAuthClientSecrets } from './lib/google-oauth-secrets.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function driveFileViewUrl(driveFileId: string): string {
  return `https://drive.google.com/file/d/${driveFileId}/view`;
}

type AssetStatus = 'new' | 'duplicate' | 'error';

type ContentAssetInsert = {
  drive_file_id: string;
  drive_web_view_link: string | null;
  drive_parent_folder_id: string | null;
  original_filename: string;
  current_filename: string | null;
  mime_type: string | null;
  file_extension: string | null;
  file_size: number | string | null;
  checksum: string | null;
  drive_created_time: string | null;
  drive_modified_time: string | null;
  media_type: string;
  source: string;
  status: AssetStatus;
  metadata_raw: Record<string, unknown>;
  error_message: string | null;
  capture_time: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  camera_make: string | null;
  camera_model: string | null;
  geo_source: string | null;
};

type ImageGeo = {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  capture_time: string | null;
  camera_make: string | null;
  camera_model: string | null;
  geo_source: 'drive_image_metadata' | null;
};

const EMPTY_IMAGE_GEO: ImageGeo = {
  latitude: null,
  longitude: null,
  altitude: null,
  capture_time: null,
  camera_make: null,
  camera_model: null,
  geo_source: null,
};

function nullIfZero(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n === 0 ? null : n;
}

/** Drive's imageMediaMetadata.time is "YYYY:MM:DD HH:MM:SS" (UTC). Convert to ISO 8601. */
function exifTimeToIso(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.trim().match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    const direct = new Date(t);
    return Number.isNaN(direct.getTime()) ? null : direct.toISOString();
  }
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function extractImageGeo(file: drive_v3.Schema$File): ImageGeo {
  const meta = file.imageMediaMetadata;
  if (!meta) return EMPTY_IMAGE_GEO;

  const lat = nullIfZero(meta.location?.latitude ?? null);
  const lon = nullIfZero(meta.location?.longitude ?? null);
  const alt = meta.location?.altitude ?? null;

  const hasGeo = lat != null && lon != null;

  return {
    latitude: lat,
    longitude: lon,
    altitude: alt != null && Number.isFinite(alt) ? alt : null,
    capture_time: exifTimeToIso(meta.time ?? null),
    camera_make: meta.cameraMake?.trim() || null,
    camera_model: meta.cameraModel?.trim() || null,
    geo_source: hasGeo ? 'drive_image_metadata' : null,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function truncateErrorMessage(msg: string, max = 2000): string {
  if (msg.length <= max) return msg;
  return `${msg.slice(0, max)}…`;
}

/** Supabase/PostgREST often returns plain `{ message, details, hint, code }` objects, not `Error`. */
function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const msg = o.message != null ? String(o.message) : '';
    const details = o.details != null ? String(o.details) : '';
    const hint = o.hint != null ? String(o.hint) : '';
    const code = o.code != null ? String(o.code) : '';
    const parts = [msg, details, hint, code].filter((s) => s.length > 0);
    if (parts.length) return parts.join(' | ');
    try {
      return JSON.stringify(e);
    } catch {
      return Object.prototype.toString.call(e);
    }
  }
  return String(e);
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const { clientId, clientSecret } = loadWebOAuthClientSecrets();
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN');
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.getAccessToken();
  return google.drive({ version: 'v3', auth: oauth2Client });
}

export async function listDriveFiles(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        'nextPageToken, files(id, name, mimeType, size, parents, md5Checksum, createdTime, modifiedTime, webViewLink, kind, spaces, version, imageMediaMetadata(location, time, cameraMake, cameraModel, width, height, rotation))',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const f of res.data.files ?? []) {
      if (f.mimeType === FOLDER_MIME) continue;
      out.push(f);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

export function inferMediaType(mimeType: string | null | undefined): string {
  const m = mimeType ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/') || m === 'application/pdf') return 'text';
  return 'other';
}

export function fileExtension(filename: string): string | null {
  const i = filename.lastIndexOf('.');
  if (i <= 0 || i === filename.length - 1) return null;
  return filename.slice(i + 1).toLowerCase();
}

export async function assetExists(
  supabase: SupabaseClient,
  driveFileId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('id')
    .eq('drive_file_id', driveFileId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** Used for checksum-based duplicate detection (best-effort when md5Checksum is present). */
async function checksumExists(
  supabase: SupabaseClient,
  checksum: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('id')
    .eq('checksum', checksum)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

function metadataRawFromDriveFile(file: drive_v3.Schema$File): Record<string, unknown> {
  return JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
}

function buildInsertRow(
  file: drive_v3.Schema$File,
  status: AssetStatus,
  errorMessage?: string,
): ContentAssetInsert {
  const name = file.name ?? 'unknown';
  const ext = fileExtension(name);
  const driveFileId = file.id;
  if (!driveFileId) {
    throw new Error('Drive file missing id');
  }

  const imageGeo = inferMediaType(file.mimeType) === 'image' ? extractImageGeo(file) : EMPTY_IMAGE_GEO;

  return {
    drive_file_id: driveFileId,
    drive_web_view_link: file.webViewLink?.trim() || driveFileViewUrl(driveFileId),
    drive_parent_folder_id: file.parents?.[0] ?? null,
    original_filename: name,
    current_filename: name,
    mime_type: file.mimeType ?? null,
    file_extension: ext,
    file_size: file.size ?? null,
    checksum: file.md5Checksum ?? null,
    drive_created_time: file.createdTime ?? null,
    drive_modified_time: file.modifiedTime ?? null,
    media_type: inferMediaType(file.mimeType),
    source: 'google_drive',
    status,
    metadata_raw: metadataRawFromDriveFile(file),
    error_message: errorMessage ?? null,
    capture_time: imageGeo.capture_time,
    latitude: imageGeo.latitude,
    longitude: imageGeo.longitude,
    altitude: imageGeo.altitude,
    camera_make: imageGeo.camera_make,
    camera_model: imageGeo.camera_model,
    geo_source: imageGeo.geo_source,
  };
}

export async function insertAsset(
  supabase: SupabaseClient,
  row: ContentAssetInsert,
): Promise<void> {
  const { error } = await supabase.from('content_assets').insert(row);
  if (error) throw error;
}

export async function ingestDriveFolder(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const folderId = requireEnv('GOOGLE_DRIVE_FOLDER_ID');

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const drive = await getDriveClient();
  const files = await listDriveFiles(drive, folderId);

  let scanned = 0;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    scanned += 1;
    const label = file.name ?? file.id ?? '(unknown)';

    try {
      const id = file.id;
      if (!id) {
        errors += 1;
        console.log(`[error] ${label}\t(no drive_file_id)\tmissing file id`);
        continue;
      }

      if (await assetExists(supabase, id)) {
        skipped += 1;
        console.log(`[skipped] ${label}\t${id}\talready in registry`);
        continue;
      }

      let status: 'new' | 'duplicate' = 'new';
      const md5 = file.md5Checksum;
      if (md5) {
        const dupByChecksum = await checksumExists(supabase, md5);
        if (dupByChecksum) {
          // Tradeoff: inserting with status `duplicate` keeps every drive_file_id in the registry.
          // Skipping the row would avoid extra rows but hides duplicate uploads from ops visibility.
          status = 'duplicate';
        }
      }

      await insertAsset(supabase, buildInsertRow(file, status));
      inserted += 1;
      const rowStatus = status === 'duplicate' ? 'duplicate' : 'new';
      console.log(`[inserted] ${label}\t${id}\tdb_status=${rowStatus}`);
    } catch (e) {
      errors += 1;
      const msg = formatUnknownError(e);
      const idPart = file.id ?? '(no drive_file_id)';
      console.log(`[error] ${label}\t${idPart}\t${truncateErrorMessage(msg, 500)}`);

      if (file.id) {
        try {
          await insertAsset(
            supabase,
            buildInsertRow(file, 'error', truncateErrorMessage(msg)),
          );
          inserted += 1;
          console.log(`[inserted] ${label}\t${file.id}\tdb_status=error (persisted)`);
        } catch (inner) {
          console.error(
            `error: failed to persist error row for ${label}: ${truncateErrorMessage(formatUnknownError(inner), 500)}`,
          );
        }
      }
    }
  }

  console.log(
    `ingest summary: scanned=${scanned} inserted=${inserted} skipped=${skipped} errors=${errors}`,
  );
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  ingestDriveFolder().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
