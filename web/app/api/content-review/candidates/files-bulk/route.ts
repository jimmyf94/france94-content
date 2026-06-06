import { NextRequest, NextResponse } from 'next/server';

import { resolveCandidateCoverThumbnail } from '@/lib/candidate-cover-thumbnail';
import {
  buildCandidateCoverThumbnailsFromAssets,
  type CandidateSourceRefs,
} from '@/lib/candidate-cover-from-assets';
import { isApiCoverThumbnailUrl } from '@/lib/review-drive-poster-url';
import { getDriveClient } from '@/lib/google-drive-server';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const MAX_IDS = 500;
const DRIVE_FALLBACK_CONCURRENCY = 2;

function isPersistableCoverUrl(url: string): boolean {
  const u = url.trim();
  if (!u.startsWith('http')) return false;
  return !isApiCoverThumbnailUrl(u);
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as string[]).filter((x) => typeof x === 'string' && x.trim().length > 0);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export async function POST(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawIds = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(rawIds) || rawIds.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'Expected body: { ids: string[] }' }, { status: 400 });
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of rawIds) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    ids.push(t);
    if (ids.length >= MAX_IDS) break;
  }

  const thumbnails: Record<string, string | null> = {};
  if (ids.length === 0) {
    return NextResponse.json({ thumbnails });
  }

  const supabase = getSupabaseServiceRole();
  const { data: rows, error: dbErr } = await supabase
    .from('post_candidates')
    .select(
      'id, cover_thumbnail_url, review_drive_folder_id, source_asset_ids, source_drive_file_ids',
    )
    .in('id', ids);

  if (dbErr) {
    console.error('[files-bulk]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  for (const id of ids) {
    thumbnails[id] = null;
  }

  const candidateRefs: CandidateSourceRefs[] = [];
  const rowById = new Map<string, Record<string, unknown>>();

  for (const row of rows ?? []) {
    const id = row.id as string;
    rowById.set(id, row as Record<string, unknown>);
    candidateRefs.push({
      candidateId: id,
      sourceAssetIds: parseStringArray(row.source_asset_ids),
      sourceDriveFileIds: parseStringArray(row.source_drive_file_ids),
    });
  }

  const assetThumbs = await buildCandidateCoverThumbnailsFromAssets(supabase, candidateRefs);
  for (const [candidateId, url] of Object.entries(assetThumbs)) {
    if (url) thumbnails[candidateId] = url;
  }

  const needsStoredOrDrive: string[] = [];

  for (const id of ids) {
    if (thumbnails[id]) continue;

    const row = rowById.get(id);
    if (!row) continue;

    const stored = (row.cover_thumbnail_url as string | null)?.trim() ?? '';
    if (stored.length > 0 && isPersistableCoverUrl(stored)) {
      thumbnails[id] = stored;
      continue;
    }

    const folderId = (row.review_drive_folder_id as string | null)?.trim() ?? '';
    if (folderId.length > 0) {
      needsStoredOrDrive.push(id);
    }
  }

  if (needsStoredOrDrive.length === 0) {
    return NextResponse.json({ thumbnails });
  }

  try {
    const drive = await getDriveClient();
    await mapWithConcurrency(needsStoredOrDrive, DRIVE_FALLBACK_CONCURRENCY, async (id) => {
      const row = rowById.get(id);
      if (!row) return;

      const folderId = (row.review_drive_folder_id as string | null)?.trim() ?? '';
      if (!folderId) return;

      const link = await resolveCandidateCoverThumbnail(
        drive,
        folderId,
        id,
        parseStringArray(row.source_drive_file_ids),
        supabase,
        parseStringArray(row.source_asset_ids),
      );
      thumbnails[id] = link;
      if (link && isPersistableCoverUrl(link)) {
        const { error: persistErr } = await supabase
          .from('post_candidates')
          .update({ cover_thumbnail_url: link, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (persistErr) {
          console.warn('[files-bulk] persist cover_thumbnail_url', id, persistErr.message);
        }
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[files-bulk drive]', msg);
    return NextResponse.json({ error: msg, thumbnails }, { status: 502 });
  }

  return NextResponse.json({ thumbnails });
}
