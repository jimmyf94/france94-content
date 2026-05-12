import { NextRequest, NextResponse } from 'next/server';

import { getDriveClient } from '@/lib/google-drive-server';
import { listReviewFolderFiles, mapDriveFileToReviewDto } from '@/lib/list-review-folder';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const MAX_IDS = 500;
const DRIVE_LIST_CONCURRENCY = 8;

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

function firstThumbnailFromFolderFiles(
  files: ReturnType<typeof mapDriveFileToReviewDto>[],
): string | null {
  return files.find((f) => f.thumbnailLink)?.thumbnailLink ?? null;
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
    .select('id, review_drive_folder_id')
    .in('id', ids);

  if (dbErr) {
    console.error('[files-bulk]', dbErr);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  for (const id of ids) {
    thumbnails[id] = null;
  }

  const withFolder = (rows ?? [])
    .map((r) => ({
      id: r.id as string,
      folderId: (r.review_drive_folder_id as string | null)?.trim() ?? '',
    }))
    .filter((r) => r.folderId.length > 0);

  if (withFolder.length === 0) {
    return NextResponse.json({ thumbnails });
  }

  try {
    const drive = await getDriveClient();
    await mapWithConcurrency(withFolder, DRIVE_LIST_CONCURRENCY, async ({ id, folderId }) => {
      const raw = await listReviewFolderFiles(drive, folderId);
      const dtos = raw.map(mapDriveFileToReviewDto);
      thumbnails[id] = firstThumbnailFromFolderFiles(dtos);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[files-bulk drive]', msg);
    return NextResponse.json({ error: msg, thumbnails }, { status: 502 });
  }

  return NextResponse.json({ thumbnails });
}
