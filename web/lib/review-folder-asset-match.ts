/** Match a file inside the candidate review folder to an index in parallel source_* arrays. */

export type AssetNameRow = {
  id: string;
  final_filename: string | null;
  current_filename: string | null;
  /** Camera/upload name; often still IMG_xxxx when final_filename was renamed on Drive */
  original_filename?: string | null;
};

function normalizeLower(s: string): string {
  return s.trim().toLowerCase();
}

function basenameLower(name: string): string {
  const n = normalizeLower(name);
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(0, i) : n;
}

/** Strip Drive duplicate suffix before extension: `photo (1).jpg` → comparable to `photo.jpg` */
function basenameComparable(name: string): string {
  let base = basenameLower(name);
  base = base.replace(/\s+\(\d+\)$/, '');
  return base;
}

/** Lowercase; strip Drive ` (n)` copy suffix; treat `.jpeg`/`.jpe` like `.jpg`. */
function comparableFullFilename(name: string): string {
  let s = normalizeLower(name.trim());
  const dup = /^(.+?)\s+\(\d+\)(\.[^./]+)$/.exec(s);
  if (dup) {
    s = dup[1] + dup[2];
  }
  s = s.replace(/\.(jpeg|jpe)$/, '.jpg');
  return s;
}

function distinctAliases(row: AssetNameRow): string[] {
  const raw = [row.final_filename, row.current_filename, row.original_filename ?? null];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const s = x?.trim();
    if (!s) continue;
    const k = normalizeLower(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function matchLiveProcessedNames(
  reviewDriveFileName: string,
  liveNames: string[],
  sourceAssetIds: string[],
): number {
  if (liveNames.length !== sourceAssetIds.length || liveNames.length === 0) return -1;

  const cfReview = comparableFullFilename(reviewDriveFileName);
  const rbReview = basenameComparable(reviewDriveFileName);

  for (let i = 0; i < liveNames.length; i++) {
    const ln = liveNames[i]?.trim() ?? '';
    if (!ln) continue;
    if (comparableFullFilename(ln) === cfReview) return i;
    if (basenameComparable(ln) === rbReview) return i;
  }
  return -1;
}

/**
 * Review copies use new Drive file IDs; `source_drive_file_ids` often still holds original IDs.
 * Resolve index by: exact drive id match, DB aliases (full + basename), live processed filenames,
 * then single-slot fallback.
 */
export function resolveReviewFolderFileSourceIndex(
  reviewDriveFileId: string,
  reviewDriveFileName: string,
  sourceAssetIds: string[],
  sourceDriveFileIds: string[],
  assetRows: AssetNameRow[],
  /** Current `name` from Drive files.get for each `source_drive_file_ids[i]` (same order) */
  liveProcessedDriveFileNames?: string[] | null,
): number {
  const idHit = sourceDriveFileIds.indexOf(reviewDriveFileId);
  if (idHit !== -1) return idHit;

  const rowById = new Map(assetRows.map((r) => [r.id, r]));
  const reviewNormRaw = normalizeLower(reviewDriveFileName);
  const reviewComparableFull = comparableFullFilename(reviewDriveFileName);
  const reviewBase = basenameComparable(reviewDriveFileName);

  for (let i = 0; i < sourceAssetIds.length; i++) {
    const row = rowById.get(sourceAssetIds[i]);
    if (!row) continue;
    for (const alias of distinctAliases(row)) {
      const an = normalizeLower(alias);
      if (an && an === reviewNormRaw) return i;
      if (comparableFullFilename(alias) === reviewComparableFull) return i;
    }
  }

  for (let i = 0; i < sourceAssetIds.length; i++) {
    const row = rowById.get(sourceAssetIds[i]);
    if (!row) continue;
    for (const alias of distinctAliases(row)) {
      const ab = basenameComparable(alias);
      if (ab && ab === reviewBase) return i;
    }
  }

  if (liveProcessedDriveFileNames?.length) {
    const hit = matchLiveProcessedNames(reviewDriveFileName, liveProcessedDriveFileNames, sourceAssetIds);
    if (hit !== -1) return hit;
  }

  // Review copy often keeps an older camera name while DB final_filename was renamed in processed/raw.
  if (sourceAssetIds.length === 1) {
    return 0;
  }

  return -1;
}
