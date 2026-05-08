import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { drive_v3 } from 'googleapis';

import { driveFileViewUrl, fileExtension, getDriveClient } from './ingest-drive-content.js';
import { formatGoogleDriveApiError } from './lib/google-drive-auth.js';

function logDrivePermissionHints(formattedMessage: string): void {
  const m = formattedMessage.toLowerCase();
  if (!m.includes('insufficient') && !m.includes('forbidden') && !m.includes('403')) return;

  console.warn(
    'Drive permission hints:\n' +
      '  1) Scope: run npm run check:drive-token — you need https://www.googleapis.com/auth/drive on the access token.\n' +
      '     If missing: revoke this app (Google Account → Security → Third-party access), then npm run oauth:google-drive, update GOOGLE_REFRESH_TOKEN.\n' +
      '  2) Shared drives: your Google account needs Content manager or Manager on that Shared drive to move/rename files between folders.\n' +
      '  3) You do not need a new GCP project; same OAuth client works once scopes + Shared drive role are correct.\n',
  );
}

async function fetchDriveWebViewLink(drive: drive_v3.Drive, driveFileId: string): Promise<string> {
  const res = await drive.files.get({
    fileId: driveFileId,
    fields: 'webViewLink',
    supportsAllDrives: true,
  });
  const link = res.data.webViewLink?.trim();
  return link || driveFileViewUrl(driveFileId);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
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

function truncateErrorMessage(msg: string, max = 2000): string {
  if (msg.length <= max) return msg;
  return `${msg.slice(0, max)}…`;
}

function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ProcessableAsset = {
  id: string;
  drive_file_id: string;
  drive_parent_folder_id: string | null;
  original_filename: string | null;
  current_filename: string | null;
  file_extension: string | null;
  capture_time: string | null;
  drive_created_time: string | null;
  imported_at: string | null;
  suggested_filename_core: string | null;
  semantic_summary: string | null;
  suggested_title: string | null;
  activity: string | null;
  content_lane: string | null;
  quality_score: number | string | null;
  geo_locality: string | null;
  geo_admin_region: string | null;
  geo_label: string | null;
  geo_raw: unknown;
  metadata_raw: unknown;
  postal_code: string | null;
  final_filename: string | null;
  rename_status: string | null;
  move_status: string | null;
  status: string;
};

const SELECT_COLUMNS =
  'id, drive_file_id, drive_parent_folder_id, original_filename, current_filename, file_extension, capture_time, drive_created_time, imported_at, suggested_filename_core, semantic_summary, suggested_title, activity, content_lane, quality_score, geo_locality, geo_admin_region, geo_label, geo_raw, metadata_raw, postal_code, final_filename, rename_status, move_status, status';

export function sanitizeFilenamePart(raw: string | null | undefined, maxLen: number): string {
  if (!raw?.trim()) return 'unknown';
  const asciiFold = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  const slug = asciiFold
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return 'unknown';
  return slug.length <= maxLen ? slug : slug.slice(0, maxLen).replace(/-+$/g, '') || 'unknown';
}

export function inferQualityLetter(score: number | string | null | undefined): string {
  if (score == null || score === '') return 'U';
  const n = typeof score === 'string' ? Number.parseFloat(score) : score;
  if (!Number.isFinite(n)) return 'U';
  if (n >= 8) return 'A';
  if (n >= 5) return 'B';
  return 'C';
}

function isoDateUtc(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function pickAssetDateUtc(asset: ProcessableAsset): string {
  return (
    isoDateUtc(asset.capture_time) ??
    isoDateUtc(asset.drive_created_time) ??
    isoDateUtc(asset.imported_at) ??
    new Date().toISOString().slice(0, 10)
  );
}

function postcodeFromGeoRaw(geoRaw: unknown): string | null {
  if (!geoRaw || typeof geoRaw !== 'object') return null;
  const addr = (geoRaw as { address?: { postcode?: string } }).address;
  const pc = addr?.postcode?.trim();
  if (!pc) return null;
  const normalized = pc.replace(/\s+/g, '').toLowerCase();
  return normalized.length ? normalized : null;
}

export function resolvePostalCode(asset: ProcessableAsset): string {
  const col = asset.postal_code?.trim();
  if (col && col !== 'unknown') return sanitizeFilenamePart(col, 12);

  const fromGeo = postcodeFromGeoRaw(asset.geo_raw);
  if (fromGeo) return sanitizeFilenamePart(fromGeo, 12);

  const meta = asset.metadata_raw;
  if (meta && typeof meta === 'object') {
    const props = meta as Record<string, unknown>;
    for (const key of ['postal_code', 'postcode', 'zip', 'zipcode']) {
      const v = props[key];
      if (typeof v === 'string' && v.trim()) return sanitizeFilenamePart(v.trim(), 12);
    }
  }

  return 'unknown';
}

export function resolveLocationSlug(asset: ProcessableAsset): string {
  if (asset.geo_locality?.trim()) return sanitizeFilenamePart(asset.geo_locality, 28);
  if (asset.geo_admin_region?.trim()) return sanitizeFilenamePart(asset.geo_admin_region, 28);
  const label = asset.geo_label?.trim();
  if (label) {
    const head = label.split(',')[0]?.trim() ?? label;
    return sanitizeFilenamePart(head, 28);
  }
  return 'unknown';
}

function basenameStem(filename: string): string {
  const i = filename.lastIndexOf('.');
  if (i <= 0) return filename;
  return filename.slice(0, i);
}

export function resolveSubjectCore(asset: ProcessableAsset): string {
  if (asset.suggested_filename_core?.trim()) {
    return sanitizeFilenamePart(asset.suggested_filename_core.trim(), 56);
  }
  if (asset.semantic_summary?.trim()) {
    return sanitizeFilenamePart(asset.semantic_summary.trim(), 56);
  }
  if (asset.suggested_title?.trim()) {
    return sanitizeFilenamePart(asset.suggested_title.trim(), 56);
  }
  const name = asset.original_filename ?? asset.current_filename ?? '';
  return sanitizeFilenamePart(basenameStem(name || 'asset'), 56);
}

function resolveExtension(asset: ProcessableAsset): string {
  const ext = asset.file_extension?.trim();
  if (ext) return ext.replace(/^\./, '').toLowerCase();
  const fromName = fileExtension(asset.current_filename ?? asset.original_filename ?? '');
  return fromName ?? 'bin';
}

export function buildFilenameBaseParts(asset: ProcessableAsset): {
  dateStr: string;
  postal: string;
  location: string;
  activity: string;
  subject: string;
  lane: string;
  quality: string;
  ext: string;
  postalForDb: string | null;
} {
  const dateStr = pickAssetDateUtc(asset);
  const postalToken = resolvePostalCode(asset);
  const postalForDb = postalToken === 'unknown' ? null : postalToken;
  return {
    dateStr,
    postal: postalToken,
    location: resolveLocationSlug(asset),
    activity: sanitizeFilenamePart(asset.activity ?? '', 20),
    subject: resolveSubjectCore(asset),
    lane: sanitizeFilenamePart(asset.content_lane ?? '', 16),
    quality: inferQualityLetter(asset.quality_score),
    ext: resolveExtension(asset),
    postalForDb,
  };
}

/** Basename without sequence: date_postal_loc_act_subj_lane_Q */
export function buildFilenamePrefix(asset: ProcessableAsset): string {
  const p = buildFilenameBaseParts(asset);
  return `${p.dateStr}_${p.postal}_${p.location}_${p.activity}_${p.subject}_${p.lane}_${p.quality}`;
}

function escapeDriveQueryLiteral(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function finalFilenameUsedElsewhere(
  supabase: SupabaseClient,
  name: string,
  excludeAssetId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('content_assets')
    .select('id')
    .eq('final_filename', name)
    .neq('id', excludeAssetId)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function driveFileNameExistsInFolder(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
): Promise<boolean> {
  const q = `'${folderId}' in parents and name = '${escapeDriveQueryLiteral(name)}' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id)',
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files?.length ?? 0) > 0;
}

export async function ensureUniqueFilename(
  supabase: SupabaseClient,
  drive: drive_v3.Drive,
  processedFolderId: string,
  asset: ProcessableAsset,
  prefix: string,
  ext: string,
): Promise<string> {
  const maxSeq = 999;
  for (let seq = 1; seq <= maxSeq; seq++) {
    const seqStr = String(seq).padStart(3, '0');
    const candidate = `${prefix}_${seqStr}.${ext}`;
    const inDb = await finalFilenameUsedElsewhere(supabase, candidate, asset.id);
    if (inDb) continue;
    const inDrive = await driveFileNameExistsInFolder(drive, processedFolderId, candidate);
    if (inDrive) continue;
    return candidate;
  }
  throw new Error(`No free filename sequence for prefix=${prefix} (exhausted ${maxSeq})`);
}

async function countPendingAnalyzed(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('content_assets')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'analyzed')
    .eq('analysis_status', 'complete')
    .is('final_filename', null)
    .is('processed_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function countPartialRetries(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('content_assets')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'error')
    .eq('rename_status', 'success')
    .eq('move_status', 'failed')
    .not('final_filename', 'is', null)
    .is('processed_at', null);
  if (error) throw error;
  return count ?? 0;
}

async function fetchPartialRetries(
  supabase: SupabaseClient,
  limit: number,
): Promise<ProcessableAsset[]> {
  if (limit <= 0) return [];
  const { data, error } = await supabase
    .from('content_assets')
    .select(SELECT_COLUMNS)
    .eq('status', 'error')
    .eq('rename_status', 'success')
    .eq('move_status', 'failed')
    .not('final_filename', 'is', null)
    .is('processed_at', null)
    .order('imported_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ProcessableAsset[];
}

async function fetchPendingAnalyzed(
  supabase: SupabaseClient,
  limit: number,
): Promise<ProcessableAsset[]> {
  if (limit <= 0) return [];
  const { data, error } = await supabase
    .from('content_assets')
    .select(SELECT_COLUMNS)
    .eq('status', 'analyzed')
    .eq('analysis_status', 'complete')
    .is('final_filename', null)
    .is('processed_at', null)
    .order('imported_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ProcessableAsset[];
}

export async function claimAssetRenaming(supabase: SupabaseClient, assetId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('content_assets')
    .update({
      status: 'renaming',
      updated_at: now,
    })
    .eq('id', assetId)
    .eq('status', 'analyzed')
    .select('id');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function fetchDriveMeta(
  drive: drive_v3.Drive,
  fileId: string,
): Promise<{ name: string; parents: string[] }> {
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, parents',
    supportsAllDrives: true,
  });
  const name = res.data.name ?? '';
  const parents = res.data.parents ?? [];
  return { name, parents };
}

function pickRemoveParent(parents: string[], inboxFolderId: string): string | null {
  if (parents.includes(inboxFolderId)) return inboxFolderId;
  if (parents.length === 1) return parents[0] ?? null;
  if (parents.length === 0) return null;
  return parents[0] ?? null;
}

async function renameAndMoveDriveFile(
  drive: drive_v3.Drive,
  params: {
    driveFileId: string;
    newName: string;
    inboxFolderId: string;
    processedFolderId: string;
  },
): Promise<void> {
  const meta = await fetchDriveMeta(drive, params.driveFileId);
  const removeParent = pickRemoveParent(meta.parents, params.inboxFolderId);
  if (!removeParent) {
    throw new Error(`Cannot resolve parent folder for drive file (parents=${meta.parents.join(',')})`);
  }

  await drive.files.update({
    fileId: params.driveFileId,
    supportsAllDrives: true,
    addParents: params.processedFolderId,
    removeParents: removeParent,
    requestBody: { name: params.newName },
  });
}

async function moveDriveFileOnly(
  drive: drive_v3.Drive,
  params: {
    driveFileId: string;
    expectedName: string;
    inboxFolderId: string;
    processedFolderId: string;
  },
): Promise<void> {
  const meta = await fetchDriveMeta(drive, params.driveFileId);
  if (meta.name !== params.expectedName) {
    throw new Error(
      `Drive name mismatch (expected ${params.expectedName}, got ${meta.name}); refusing move-only retry`,
    );
  }
  const removeParent = pickRemoveParent(meta.parents, params.inboxFolderId);
  if (!removeParent) {
    throw new Error(`Cannot resolve parent folder for move retry (parents=${meta.parents.join(',')})`);
  }

  await drive.files.update({
    fileId: params.driveFileId,
    supportsAllDrives: true,
    addParents: params.processedFolderId,
    removeParents: removeParent,
  });
}

async function markProcessed(
  supabase: SupabaseClient,
  assetId: string,
  payload: {
    finalFilename: string;
    postalForDb: string | null;
    processedFolderId: string;
    driveWebViewLink?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    final_filename: payload.finalFilename,
    current_filename: payload.finalFilename,
    renamed_filename: payload.finalFilename,
    postal_code: payload.postalForDb,
    processed_drive_folder_id: payload.processedFolderId,
    processed_at: now,
    rename_status: 'success',
    move_status: 'success',
    drive_parent_folder_id: payload.processedFolderId,
    status: 'processed',
    error_message: null,
    updated_at: now,
  };
  if (payload.driveWebViewLink) {
    update.drive_web_view_link = payload.driveWebViewLink;
  }

  const { error } = await supabase.from('content_assets').update(update).eq('id', assetId);
  if (error) throw error;
}

async function markRenameError(
  supabase: SupabaseClient,
  assetId: string,
  message: string,
  renameStatus: 'failed' | 'success',
  moveStatus: 'failed' | 'success' | 'pending',
  extras?: Partial<{ finalFilename: string; postalForDb: string | null }>,
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: 'error',
    error_message: truncateErrorMessage(message),
    rename_status: renameStatus,
    move_status: moveStatus,
    updated_at: now,
  };
  if (extras?.finalFilename != null) update.final_filename = extras.finalFilename;
  if (extras?.postalForDb !== undefined) update.postal_code = extras.postalForDb;

  const { error } = await supabase.from('content_assets').update(update).eq('id', assetId);
  if (error) throw error;
}

async function revertClaimFromRenaming(
  supabase: SupabaseClient,
  assetId: string,
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('content_assets')
    .update({
      status: 'analyzed',
      rename_status: 'failed',
      move_status: 'failed',
      error_message: truncateErrorMessage(message),
      updated_at: now,
    })
    .eq('id', assetId)
    .eq('status', 'renaming');

  if (error) throw error;
}

export async function processAnalyzedAssets(): Promise<void> {
  const batchSize = envInt('CONTENT_RENAME_BATCH_SIZE', 10);
  const inboxFolderId = requireEnv('GOOGLE_DRIVE_FOLDER_ID');
  const processedFolderId = requireEnv('GOOGLE_DRIVE_PROCESSED_RAW_FOLDER_ID');

  const supabase = getSupabaseClient();
  const drive = await getDriveClient();

  const pendingAnalyzed = await countPendingAnalyzed(supabase);
  const pendingRetry = await countPartialRetries(supabase);
  console.log(
    `pending rename: analyzed=${pendingAnalyzed} move_retry=${pendingRetry} (batch_size=${batchSize})`,
  );

  const partial = await fetchPartialRetries(supabase, batchSize);
  const rest = batchSize - partial.length;
  const analyzed = await fetchPendingAnalyzed(supabase, rest);
  const batch: ProcessableAsset[] = [...partial, ...analyzed];

  if (batch.length === 0) {
    console.log('summary: processed=0 skipped=0 failed=0');
    return;
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const asset of batch) {
    const oldName = asset.current_filename ?? asset.original_filename ?? '(unknown)';

    const isMoveRetry =
      asset.status === 'error' &&
      asset.rename_status === 'success' &&
      asset.move_status === 'failed' &&
      asset.final_filename;

    try {
      if (isMoveRetry) {
        const finalName = asset.final_filename as string;
        console.log(`[move-retry]\t${asset.id}\t${oldName}\t→ keep name ${finalName}`);
        await moveDriveFileOnly(drive, {
          driveFileId: asset.drive_file_id,
          expectedName: finalName,
          inboxFolderId,
          processedFolderId,
        });
        const parts = buildFilenameBaseParts(asset);
        const link = await fetchDriveWebViewLink(drive, asset.drive_file_id);
        await markProcessed(supabase, asset.id, {
          finalFilename: finalName,
          postalForDb: parts.postalForDb,
          processedFolderId,
          driveWebViewLink: link,
        });
        console.log(`[done]\t${asset.id}\tmoved\t${finalName}`);
        processed += 1;
        continue;
      }

      const claimed = await claimAssetRenaming(supabase, asset.id);
      if (!claimed) {
        console.log(`[skipped]\t${asset.id}\tclaim failed (not analyzed)`);
        skipped += 1;
        continue;
      }

      const prefix = buildFilenamePrefix(asset);
      const ext = resolveExtension(asset);
      const parts = buildFilenameBaseParts(asset);
      const finalName = await ensureUniqueFilename(supabase, drive, processedFolderId, asset, prefix, ext);

      console.log(`[process]\t${asset.id}\t${oldName}\t→ ${finalName}`);

      await renameAndMoveDriveFile(drive, {
        driveFileId: asset.drive_file_id,
        newName: finalName,
        inboxFolderId,
        processedFolderId,
      });

      const link = await fetchDriveWebViewLink(drive, asset.drive_file_id);
      await markProcessed(supabase, asset.id, {
        finalFilename: finalName,
        postalForDb: parts.postalForDb,
        processedFolderId,
        driveWebViewLink: link,
      });

      console.log(`[done]\t${asset.id}\trenamed+moved\t${finalName}`);
      processed += 1;
    } catch (e) {
      const msg = truncateErrorMessage(formatGoogleDriveApiError(e), 400);
      console.warn(`[failed]\t${asset.id}\t${msg}`);
      logDrivePermissionHints(msg);

      if (isMoveRetry) {
        await markRenameError(supabase, asset.id, msg, 'success', 'failed');
      } else if (asset.status === 'analyzed') {
        await revertClaimFromRenaming(supabase, asset.id, msg);
      } else {
        await markRenameError(supabase, asset.id, msg, 'failed', 'failed');
      }

      failed += 1;
    }
  }

  console.log(`summary: processed=${processed} skipped=${skipped} failed=${failed}`);
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  processAnalyzedAssets().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
