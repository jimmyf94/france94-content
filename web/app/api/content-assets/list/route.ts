import { NextRequest, NextResponse } from 'next/server';

import { getDriveClient } from '@/lib/google-drive-server';
import type { AssetListRow } from '@/lib/asset-library-types';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const LIST_COLUMNS = [
  'id',
  'drive_file_id',
  'drive_web_view_link',
  'original_filename',
  'current_filename',
  'final_filename',
  'mime_type',
  'media_type',
  'activity',
  'content_lane',
  'quality_score',
  'candidate_eligibility',
  'usage_count',
  'suggestion_count',
  'last_used_at',
  'last_suggested_at',
  'processed_at',
  'semantic_summary',
  'visual_summary',
  'tags',
].join(',');

const MAX_LIMIT = 100;
const DRIVE_THUMB_CONCURRENCY = 8;

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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function fetchThumbnailLinks(
  fileIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const id of fileIds) out.set(id, null);
  if (fileIds.length === 0) return out;

  const drive = await getDriveClient();
  await mapWithConcurrency(fileIds, DRIVE_THUMB_CONCURRENCY, async (fileId) => {
    try {
      const meta = await drive.files.get({
        fileId,
        fields: 'id,thumbnailLink',
        supportsAllDrives: true,
      });
      out.set(fileId, meta.data.thumbnailLink ?? null);
    } catch {
      out.set(fileId, null);
    }
  });
  return out;
}

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(
    Math.max(parseInt(sp.get('limit') ?? '24', 10) || 24, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0);

  const q = sp.get('q')?.trim() ?? '';
  const mediaType = sp.get('media_type')?.trim() ?? '';
  const activity = sp.get('activity')?.trim() ?? '';
  const contentLane = sp.get('content_lane')?.trim() ?? '';
  const eligibility = sp.get('eligibility')?.trim() ?? '';
  const used = sp.get('used')?.trim() ?? '';
  const staleOnly = sp.get('stale_excluded') === '1' || sp.get('stale_excluded') === 'true';
  const qualityMinRaw = sp.get('quality_min')?.trim() ?? '';
  const dateFrom = sp.get('date_from')?.trim() ?? '';
  const dateTo = sp.get('date_to')?.trim() ?? '';

  const supabase = getSupabaseServiceRole();
  let query = supabase
    .from('content_assets')
    .select(LIST_COLUMNS)
    .eq('status', 'processed')
    .order('processed_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  if (mediaType) query = query.eq('media_type', mediaType);
  if (activity) query = query.eq('activity', activity);
  if (contentLane) query = query.eq('content_lane', contentLane);
  if (eligibility) query = query.eq('candidate_eligibility', eligibility);

  if (staleOnly) {
    query = query.in('candidate_eligibility', ['stale', 'excluded']);
  }

  if (used === 'true' || used === 'used') {
    query = query.gt('usage_count', 0);
  } else if (used === 'false' || used === 'unused') {
    query = query.or('usage_count.is.null,usage_count.eq.0');
  }

  const qm = parseFloat(qualityMinRaw);
  if (qualityMinRaw !== '' && Number.isFinite(qm)) {
    query = query.gte('quality_score', qm);
  }

  if (dateFrom) query = query.gte('processed_at', `${dateFrom}T00:00:00.000Z`);
  if (dateTo) query = query.lte('processed_at', `${dateTo}T23:59:59.999Z`);

  if (q) {
    const safe = q.replace(/,/g, ' ').replace(/\(/g, ' ').replace(/\)/g, ' ');
    const esc = safe.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const p = `%${esc}%`;
    query = query.or(
      `original_filename.ilike.${p},current_filename.ilike.${p},final_filename.ilike.${p},semantic_summary.ilike.${p},visual_summary.ilike.${p}`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error('[content-assets list]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const fileIds = rows
    .map((r) => String(r.drive_file_id ?? '').trim())
    .filter(Boolean);

  let thumbs = new Map<string, string | null>();
  try {
    thumbs = await fetchThumbnailLinks(fileIds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[content-assets list thumbs]', msg);
  }

  const items: AssetListRow[] = rows.map((r) => {
    const fid = String(r.drive_file_id ?? '').trim();
    return {
      id: String(r.id),
      drive_file_id: fid,
      drive_web_view_link: (r.drive_web_view_link as string | null) ?? null,
      original_filename: (r.original_filename as string | null) ?? null,
      current_filename: (r.current_filename as string | null) ?? null,
      final_filename: (r.final_filename as string | null) ?? null,
      mime_type: (r.mime_type as string | null) ?? null,
      media_type: (r.media_type as string | null) ?? null,
      activity: (r.activity as string | null) ?? null,
      content_lane: (r.content_lane as string | null) ?? null,
      quality_score: (r.quality_score as number | string | null) ?? null,
      candidate_eligibility: (r.candidate_eligibility as string | null) ?? 'eligible',
      usage_count: typeof r.usage_count === 'number' ? r.usage_count : 0,
      suggestion_count: typeof r.suggestion_count === 'number' ? r.suggestion_count : 0,
      last_used_at: (r.last_used_at as string | null) ?? null,
      last_suggested_at: (r.last_suggested_at as string | null) ?? null,
      processed_at: (r.processed_at as string | null) ?? null,
      thumbnail_link: thumbs.get(fid) ?? null,
    };
  });

  const next_offset = rows.length < limit ? null : offset + limit;

  return NextResponse.json(
    { items, next_offset },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
