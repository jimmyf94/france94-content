import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildInstagramPermalink,
  getMediaInsights,
  getUserMedia,
  probeInsightsPermission,
  type InstagramMediaItem,
} from '@fr94/publishing/instagram-graph';

export type CandidateInstagramFeedback = {
  instagram_media_id: string;
  permalink: string | null;
  posted_at: string | null;
  like_count: number | null;
  comments_count: number | null;
  views: number | null;
  shares: number | null;
  avg_watch_time_ms: number | null;
  insights_available: boolean;
  fetched_at: string;
};

export type PublishedJobMeta = {
  publishing_job_id: string | null;
  instagram_media_id: string | null;
  instagram_permalink: string | null;
  published_at: string | null;
};

export type PublishedCandidateMeta = PublishedJobMeta & {
  feedback: CandidateInstagramFeedback | null;
};

function pickThumbnailUrl(item: InstagramMediaItem): string | null {
  const thumb = item.thumbnail_url?.trim();
  if (thumb) return thumb;
  return item.media_url?.trim() || null;
}

function hasAnyInsights(insights: {
  views: number | null;
  shares: number | null;
  avgWatchTimeMs: number | null;
}): boolean {
  return (
    insights.views != null || insights.shares != null || insights.avgWatchTimeMs != null
  );
}

export async function fetchInstagramFeedbackByMediaIds(
  mediaIds: string[],
): Promise<Map<string, CandidateInstagramFeedback>> {
  const wanted = new Set(mediaIds.filter(Boolean));
  const out = new Map<string, CandidateInstagramFeedback>();
  if (wanted.size === 0) return out;

  try {
    const media = await getUserMedia({ limit: 50 });
    const probeMedia = media[0];
    const insightsAllowed = probeMedia ? await probeInsightsPermission(probeMedia.id) : false;
    const emptyInsights = { views: null, shares: null, avgWatchTimeMs: null };
    const fetchedAt = new Date().toISOString();

    await Promise.all(
      media
        .filter((item) => wanted.has(item.id))
        .map(async (item) => {
          const insights = insightsAllowed
            ? await getMediaInsights(item.id, item.media_product_type, item.media_type)
            : emptyInsights;

          out.set(item.id, {
            instagram_media_id: item.id,
            permalink: buildInstagramPermalink({
              permalink: item.permalink,
              shortcode: item.shortcode,
              media_product_type: item.media_product_type,
              media_type: item.media_type,
            }),
            posted_at: item.timestamp,
            like_count: item.like_count,
            comments_count: item.comments_count,
            views: insights.views,
            shares: insights.shares,
            avg_watch_time_ms: insights.avgWatchTimeMs,
            insights_available: hasAnyInsights(insights),
            fetched_at: fetchedAt,
          });
        }),
    );
  } catch (e) {
    console.warn('[published feedback] Graph fetch failed', e);
  }

  return out;
}

export async function loadPublishingJobMetaByCandidateIds(
  supabase: SupabaseClient,
  candidateIds: string[],
): Promise<Map<string, PublishedJobMeta>> {
  const out = new Map<string, PublishedJobMeta>();
  if (candidateIds.length === 0) return out;

  const { data, error } = await supabase
    .from('publishing_jobs')
    .select(
      'id, post_candidate_id, instagram_media_id, instagram_permalink, published_at',
    )
    .in('post_candidate_id', candidateIds);

  if (error) {
    console.warn('[published feedback] publishing_jobs read', error.message);
    return out;
  }

  for (const row of data ?? []) {
    const cid = String((row as { post_candidate_id?: string }).post_candidate_id ?? '');
    if (!cid) continue;
    out.set(cid, {
      publishing_job_id: String((row as { id?: string }).id ?? '') || null,
      instagram_media_id:
        ((row as { instagram_media_id?: string | null }).instagram_media_id as
          | string
          | null) ?? null,
      instagram_permalink:
        ((row as { instagram_permalink?: string | null }).instagram_permalink as
          | string
          | null) ?? null,
      published_at:
        ((row as { published_at?: string | null }).published_at as string | null) ?? null,
    });
  }

  return out;
}

export async function loadFeedbackSnapshotsByMediaIds(
  supabase: SupabaseClient,
  mediaIds: string[],
): Promise<Map<string, CandidateInstagramFeedback>> {
  const out = new Map<string, CandidateInstagramFeedback>();
  const ids = mediaIds.filter(Boolean);
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from('instagram_post_feedback_snapshots')
    .select(
      'instagram_media_id, permalink, like_count, comments_count, views, shares, avg_watch_time_ms, posted_at, fetched_at',
    )
    .in('instagram_media_id', ids);

  if (error) {
    console.warn('[published feedback] snapshot read', error.message);
    return out;
  }

  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const mediaId = String(r.instagram_media_id ?? '');
    if (!mediaId) continue;
    out.set(mediaId, {
      instagram_media_id: mediaId,
      permalink: (r.permalink as string | null) ?? null,
      posted_at: (r.posted_at as string | null) ?? null,
      like_count: typeof r.like_count === 'number' ? r.like_count : null,
      comments_count: typeof r.comments_count === 'number' ? r.comments_count : null,
      views: typeof r.views === 'number' ? r.views : null,
      shares: typeof r.shares === 'number' ? r.shares : null,
      avg_watch_time_ms:
        typeof r.avg_watch_time_ms === 'number' ? r.avg_watch_time_ms : null,
      insights_available:
        typeof r.views === 'number' ||
        typeof r.shares === 'number' ||
        typeof r.avg_watch_time_ms === 'number',
      fetched_at: String(r.fetched_at ?? new Date().toISOString()),
    });
  }

  return out;
}

export async function upsertFeedbackSnapshots(
  supabase: SupabaseClient,
  rows: Array<{
    feedback: CandidateInstagramFeedback;
    post_candidate_id: string;
    publishing_job_id: string | null;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  const now = new Date().toISOString();
  for (const row of rows) {
    const f = row.feedback;
    const { error } = await supabase.from('instagram_post_feedback_snapshots').upsert(
      {
        instagram_media_id: f.instagram_media_id,
        post_candidate_id: row.post_candidate_id,
        publishing_job_id: row.publishing_job_id,
        permalink: f.permalink,
        like_count: f.like_count,
        comments_count: f.comments_count,
        views: f.views,
        shares: f.shares,
        avg_watch_time_ms: f.avg_watch_time_ms,
        posted_at: f.posted_at,
        fetched_at: f.fetched_at || now,
      },
      { onConflict: 'instagram_media_id' },
    );
    if (error) {
      console.warn('[published feedback] snapshot upsert', error.message);
    }
  }
}

export async function enrichPublishedCandidates(
  supabase: SupabaseClient,
  candidateIds: string[],
  opts?: { fetchLive?: boolean },
): Promise<Map<string, PublishedCandidateMeta>> {
  const jobMeta = await loadPublishingJobMetaByCandidateIds(supabase, candidateIds);
  const mediaIds = [...jobMeta.values()]
    .map((m) => m.instagram_media_id)
    .filter((id): id is string => Boolean(id));

  let feedbackByMedia = await loadFeedbackSnapshotsByMediaIds(supabase, mediaIds);

  if (opts?.fetchLive !== false) {
    const live = await fetchInstagramFeedbackByMediaIds(mediaIds);
    for (const [mediaId, feedback] of live) {
      feedbackByMedia.set(mediaId, feedback);
    }
  }

  const out = new Map<string, PublishedCandidateMeta>();
  const snapshotRows: Array<{
    feedback: CandidateInstagramFeedback;
    post_candidate_id: string;
    publishing_job_id: string | null;
  }> = [];

  for (const [candidateId, job] of jobMeta) {
    const feedback = job.instagram_media_id
      ? (feedbackByMedia.get(job.instagram_media_id) ?? null)
      : null;
    out.set(candidateId, { ...job, feedback });
    if (feedback && job.publishing_job_id) {
      snapshotRows.push({
        feedback,
        post_candidate_id: candidateId,
        publishing_job_id: job.publishing_job_id,
      });
    }
  }

  if (opts?.fetchLive !== false && snapshotRows.length > 0) {
    await upsertFeedbackSnapshots(supabase, snapshotRows);
  }

  for (const candidateId of candidateIds) {
    if (!out.has(candidateId)) {
      out.set(candidateId, {
        publishing_job_id: null,
        instagram_media_id: null,
        instagram_permalink: null,
        published_at: null,
        feedback: null,
      });
    }
  }

  return out;
}

export function feedbackSummaryForPrompt(
  feedback: CandidateInstagramFeedback | null | undefined,
): Record<string, unknown> | undefined {
  if (!feedback) return undefined;
  return {
    permalink: feedback.permalink,
    posted_at: feedback.posted_at,
    like_count: feedback.like_count,
    comments_count: feedback.comments_count,
    views: feedback.views,
    shares: feedback.shares,
    avg_watch_time_ms: feedback.avg_watch_time_ms,
  };
}
