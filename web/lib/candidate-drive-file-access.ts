import type { SupabaseClient } from '@supabase/supabase-js';

export type CandidateDriveAccess = {
  reviewFolderId: string | null;
  allowedDriveFileIds: Set<string>;
};

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as string[]).filter((x) => typeof x === 'string' && x.trim().length > 0);
}

function normalizeIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Collect source asset / drive ids from candidate row and clips-v1 reel_instructions. */
export function extractCandidateSourceRefs(row: {
  source_asset_ids?: unknown;
  source_drive_file_ids?: unknown;
  reel_instructions?: unknown;
}): { sourceAssetIds: string[]; sourceDriveFileIds: string[] } {
  const sourceAssetIds = normalizeIds(parseStringArray(row.source_asset_ids));
  const sourceDriveFileIds = normalizeIds(parseStringArray(row.source_drive_file_ids));

  const ri = row.reel_instructions;
  if (ri != null && typeof ri === 'object' && !Array.isArray(ri)) {
    const spec = ri as Record<string, unknown>;
    if (spec.version === 'clips-v1' && Array.isArray(spec.clips)) {
      for (const clip of spec.clips) {
        if (clip == null || typeof clip !== 'object') continue;
        const c = clip as Record<string, unknown>;
        if (typeof c.asset_id === 'string' && c.asset_id.trim()) {
          sourceAssetIds.push(c.asset_id.trim());
        }
        if (typeof c.drive_file_id === 'string' && c.drive_file_id.trim()) {
          sourceDriveFileIds.push(c.drive_file_id.trim());
        }
      }
    }
  }

  return {
    sourceAssetIds: normalizeIds(sourceAssetIds),
    sourceDriveFileIds: normalizeIds(sourceDriveFileIds),
  };
}

export async function loadCandidateDriveAccess(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<CandidateDriveAccess | null> {
  const { data: row, error } = await supabase
    .from('post_candidates')
    .select('review_drive_folder_id, source_asset_ids, source_drive_file_ids, reel_instructions')
    .eq('id', candidateId)
    .maybeSingle();

  if (error) {
    console.error('[candidate-drive-access]', error);
    return null;
  }
  if (!row) return null;

  const { sourceAssetIds, sourceDriveFileIds } = extractCandidateSourceRefs(row);
  const allowedDriveFileIds = new Set<string>(sourceDriveFileIds);

  if (sourceAssetIds.length > 0) {
    const { data: assets, error: assetErr } = await supabase
      .from('content_assets')
      .select('drive_file_id')
      .in('id', sourceAssetIds);

    if (assetErr) {
      console.warn('[candidate-drive-access] assets', assetErr.message);
    } else {
      for (const a of assets ?? []) {
        const driveId = (a.drive_file_id as string | null)?.trim();
        if (driveId) allowedDriveFileIds.add(driveId);
      }
    }
  }

  return {
    reviewFolderId: (row.review_drive_folder_id as string | null)?.trim() || null,
    allowedDriveFileIds,
  };
}

export function isCandidateDriveFileAllowed(
  access: CandidateDriveAccess,
  fileId: string,
  parents?: string[] | null,
): boolean {
  const folderId = access.reviewFolderId;
  if (folderId && parents?.includes(folderId)) return true;
  return access.allowedDriveFileIds.has(fileId);
}
