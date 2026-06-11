import { NextRequest, NextResponse } from 'next/server';

import {
  getMediaInsights,
  getUserMedia,
  probeInsightsPermission,
  type InstagramMediaItem,
} from '@fr94/publishing/instagram-graph';

import { assertReviewAuthorized } from '@/lib/review-auth';

export type FeedbackPostRow = {
  id: string;
  postedAt: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  postTypeLabel: string;
  permalink: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  views: number | null;
  shares: number | null;
  avgWatchTimeMs: number | null;
};

function formatPostTypeLabel(item: InstagramMediaItem): string {
  const product = (item.media_product_type ?? '').toUpperCase();
  const media = (item.media_type ?? '').toUpperCase();
  if (product === 'REELS') return 'Reel';
  if (product === 'STORY') return 'Story';
  if (product === 'FEED' && media === 'CAROUSEL_ALBUM') return 'Carousel';
  if (product === 'FEED' && media === 'VIDEO') return 'Feed video';
  if (product === 'FEED' && media === 'IMAGE') return 'Feed image';
  if (media) return media.replace(/_/g, ' ').toLowerCase();
  if (product) return product.replace(/_/g, ' ').toLowerCase();
  return 'Post';
}

function pickThumbnailUrl(item: InstagramMediaItem): string | null {
  const thumb = item.thumbnail_url?.trim();
  if (thumb) return thumb;
  const media = item.media_url?.trim();
  return media || null;
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

export async function GET(req: NextRequest) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const limitRaw = req.nextUrl.searchParams.get('limit')?.trim();
  const limit = limitRaw ? Math.min(50, Math.max(1, Number.parseInt(limitRaw, 10) || 25)) : 25;

  try {
    const media = await getUserMedia({ limit });
    const probeMedia = media[0];
    const insightsAllowed = probeMedia ? await probeInsightsPermission(probeMedia.id) : false;

    const emptyInsights = { views: null, shares: null, avgWatchTimeMs: null };
    let insightsAvailable = false;

    const posts: FeedbackPostRow[] = await Promise.all(
      media.map(async (item) => {
        const insights = insightsAllowed
          ? await getMediaInsights(item.id, item.media_product_type, item.media_type)
          : emptyInsights;
        if (hasAnyInsights(insights)) insightsAvailable = true;

        return {
          id: item.id,
          postedAt: item.timestamp,
          thumbnailUrl: pickThumbnailUrl(item),
          mediaType: item.media_type,
          mediaProductType: item.media_product_type,
          postTypeLabel: formatPostTypeLabel(item),
          permalink: item.permalink,
          likeCount: item.like_count,
          commentsCount: item.comments_count,
          views: insights.views,
          shares: insights.shares,
          avgWatchTimeMs: insights.avgWatchTimeMs,
        };
      }),
    );

    return NextResponse.json({
      posts,
      insightsAvailable,
      insightsPermissionDenied: !insightsAllowed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Instagram feedback';
    console.error('[feedback GET]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
