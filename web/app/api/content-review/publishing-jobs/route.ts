import { NextRequest, NextResponse } from 'next/server';

import { buildCandidateCoverThumbnailsFromAssets } from '@/lib/candidate-cover-from-assets';
import type { PublishingQueueItem } from '@/lib/publishing-types';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const LIVE_BOUND_STATUSES = [
  'scheduled',
  'draft',
  'ready_to_publish',
  'publishing',
  'processing',
  'containers_created',
] as const;

const STATUS_SORT_PRIORITY: Record<string, number> = {
  scheduled: 0,
  publishing: 1,
  processing: 2,
  containers_created: 3,
  ready_to_publish: 4,
  draft: 5,
};

function parsePreparedMediaFirstUrl(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sorted = [...raw].sort((a, b) => {
    const ao = typeof (a as { order?: unknown })?.order === 'number' ? (a as { order: number }).order : 0;
    const bo = typeof (b as { order?: unknown })?.order === 'number' ? (b as { order: number }).order : 0;
    return ao - bo;
  });
  for (const item of sorted) {
    if (item != null && typeof item === 'object') {
      const url = (item as { public_url?: unknown }).public_url;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
  }
  return null;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as string[]).filter((x) => typeof x === 'string' && x.trim().length > 0);
}

function sortQueueItems(items: PublishingQueueItem[]): PublishingQueueItem[] {
  return [...items].sort((a, b) => {
    const pa = STATUS_SORT_PRIORITY[a.status] ?? 99;
    const pb = STATUS_SORT_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;

    if (a.status === 'scheduled' && b.status === 'scheduled') {
      const ta = Date.parse(a.scheduled_publish_at ?? '');
      const tb = Date.parse(b.scheduled_publish_at ?? '');
      const sa = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
      const sb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
      return sa - sb;
    }

    const ra = Date.parse(a.candidate.ready_to_publish_at ?? a.created_at);
    const rb = Date.parse(b.candidate.ready_to_publish_at ?? b.created_at);
    const fa = Number.isFinite(ra) ? ra : 0;
    const fb = Number.isFinite(rb) ? rb : 0;
    return fa - fb;
  });
}

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const supabase = getSupabaseServiceRole();
  const { data: jobs, error: jobErr } = await supabase
    .from('publishing_jobs')
    .select(
      'id, post_candidate_id, status, publish_type, scheduled_publish_at, published_at, instagram_permalink, prepared_media, created_at',
    )
    .in('status', [...LIVE_BOUND_STATUSES]);

  if (jobErr) {
    console.error('[publishing-jobs list]', jobErr);
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  const jobRows = jobs ?? [];
  if (jobRows.length === 0) {
    return NextResponse.json({ items: [] satisfies PublishingQueueItem[] });
  }

  const candidateIds = [...new Set(jobRows.map((j) => j.post_candidate_id as string))];
  const { data: candidates, error: cErr } = await supabase
    .from('post_candidates')
    .select(
      'id, title, post_type, status, review_drive_folder_url, cover_thumbnail_url, ready_to_publish_at, source_asset_ids, source_drive_file_ids',
    )
    .in('id', candidateIds);

  if (cErr) {
    console.error('[publishing-jobs candidates]', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const candidateById = new Map(
    (candidates ?? []).map((c) => [c.id as string, c]),
  );

  const assetThumbs = await buildCandidateCoverThumbnailsFromAssets(
    supabase,
    (candidates ?? []).map((c) => ({
      candidateId: c.id as string,
      sourceAssetIds: parseStringArray(c.source_asset_ids),
      sourceDriveFileIds: parseStringArray(c.source_drive_file_ids),
    })),
  );

  const items: PublishingQueueItem[] = jobRows
    .map((job) => {
      const candidate = candidateById.get(job.post_candidate_id as string);
      if (!candidate) return null;

      const candidateId = candidate.id as string;
      const preparedThumb = parsePreparedMediaFirstUrl(job.prepared_media);
      const coverThumb = (candidate.cover_thumbnail_url as string | null)?.trim() || null;
      const assetThumb = assetThumbs[candidateId] ?? null;
      const thumbnailUrl = assetThumb ?? coverThumb ?? preparedThumb;

      return {
        id: job.id as string,
        post_candidate_id: job.post_candidate_id as string,
        status: job.status as string,
        publish_type: job.publish_type as string,
        scheduled_publish_at: (job.scheduled_publish_at as string | null) ?? null,
        published_at: (job.published_at as string | null) ?? null,
        instagram_permalink: (job.instagram_permalink as string | null) ?? null,
        created_at: job.created_at as string,
        thumbnail_url: thumbnailUrl,
        candidate: {
          id: candidateId,
          title: (candidate.title as string | null) ?? null,
          post_type: candidate.post_type as string,
          status: candidate.status as string,
          review_drive_folder_url: (candidate.review_drive_folder_url as string | null) ?? null,
          cover_thumbnail_url: thumbnailUrl,
          ready_to_publish_at: (candidate.ready_to_publish_at as string | null) ?? null,
        },
      };
    })
    .filter((x): x is PublishingQueueItem => x != null);

  return NextResponse.json({ items: sortQueueItems(items) });
}
