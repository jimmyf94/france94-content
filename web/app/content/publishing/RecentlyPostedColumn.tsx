'use client';

import { useMemo } from 'react';

import type { FeedbackPostRow } from '@/lib/feedback-types';
import {
  formatFeedbackCompactNumber,
  formatFeedbackShortDate,
  getFeedbackThumbnailBadge,
} from '@/lib/feedback-format';
import { startOfTodayLocal } from '@/lib/publishing-schedule-datetime';

import { groupPostedPostsByTime } from './publishingPostedFeed';

type RecentlyPostedColumnProps = {
  posts: FeedbackPostRow[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  compact?: boolean;
};

function formatPostedWhen(iso: string | null, groupKey: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (groupKey === 'today' || groupKey === 'yesterday') {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (groupKey === 'this-week' || groupKey === 'last-week') {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return formatFeedbackShortDate(iso);
}

function PostedRow({ post, groupKey }: { post: FeedbackPostRow; groupKey: string }) {
  const badge = getFeedbackThumbnailBadge(post);

  return (
    <li className="flex gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      {post.thumbnailUrl ? (
        <a
          href={post.permalink ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[var(--border)]"
          title="Open on Instagram"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          {badge ? (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-0.5 text-[8px] text-white">
              {badge}
            </span>
          ) : null}
        </a>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[10px] text-[var(--muted)]">
          —
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-[var(--text)]">
              {post.postTypeLabel}
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              {formatPostedWhen(post.postedAt, groupKey)}
            </p>
          </div>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[10px] text-[var(--accent)] hover:opacity-80"
            >
              IG
            </a>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-[var(--muted)]">
          <span>{formatFeedbackCompactNumber(post.views)} views</span>
          <span>{formatFeedbackCompactNumber(post.likeCount)} likes</span>
        </div>
      </div>
    </li>
  );
}

export function RecentlyPostedColumn({
  posts,
  loading,
  error,
  onRefresh,
  compact = false,
}: RecentlyPostedColumnProps) {
  const today = useMemo(() => startOfTodayLocal(), []);
  const groups = useMemo(() => groupPostedPostsByTime(posts, today), [posts, today]);

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Recently posted</h2>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">
            Live from your Instagram account
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRefresh()}
          disabled={loading}
          className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      <div className={`scrollbar-thin min-h-0 flex-1 overflow-auto ${compact ? 'p-2' : 'p-3'}`}>
        {error ? (
          <p className="text-xs text-[var(--bad)]">{error}</p>
        ) : loading && posts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Loading posts…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No posts found on this Instagram account.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.key}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {group.label}
                </h3>
                <ul className="flex list-none flex-col gap-2" role="list">
                  {group.posts.map((post) => (
                    <PostedRow key={post.id} post={post} groupKey={group.key} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
