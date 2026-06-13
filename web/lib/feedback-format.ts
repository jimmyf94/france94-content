import type { FeedbackPostRow } from '@/lib/feedback-types';

export function formatFeedbackDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatFeedbackShortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatFeedbackNumber(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

export function formatFeedbackCompactNumber(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatAvgWatchTime(ms: number | null): string {
  if (ms == null) return '—';
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

export function getFeedbackThumbnailBadge(row: FeedbackPostRow): string | null {
  const product = (row.mediaProductType ?? '').toUpperCase();
  const media = (row.mediaType ?? '').toUpperCase();
  if (product === 'REELS') return 'Reel';
  if (product === 'STORY') return 'Story';
  if (media === 'CAROUSEL_ALBUM') return null;
  if (media === 'VIDEO') return 'Video';
  return null;
}

export function isFeedbackVideoType(row: FeedbackPostRow): boolean {
  const badge = getFeedbackThumbnailBadge(row);
  return badge === 'Reel' || badge === 'Video';
}
