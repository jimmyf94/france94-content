'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  formatAvgWatchTime,
  formatFeedbackDate,
  formatFeedbackNumber,
  getFeedbackThumbnailBadge,
} from '@/lib/feedback-format';
import type { FeedbackPostRow, FeedbackResponse } from '@/lib/feedback-types';
import { readJsonResponse } from '@/lib/read-json-response';

export function FeedbackTable() {
  const [posts, setPosts] = useState<FeedbackPostRow[]>([]);
  const [insightsAvailable, setInsightsAvailable] = useState<boolean | null>(null);
  const [insightsPermissionDenied, setInsightsPermissionDenied] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-review/feedback?limit=50', {
        credentials: 'include',
      });
      const json = await readJsonResponse<FeedbackResponse>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setPosts(json.posts ?? []);
      setInsightsAvailable(json.insightsAvailable ?? false);
      setInsightsPermissionDenied(json.insightsPermissionDenied ?? false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPosts([]);
      setInsightsAvailable(null);
      setInsightsPermissionDenied(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-base font-semibold text-[var(--text)]">Feedback</h1>
            <p className="text-xs text-[var(--muted)]">
              Live metrics from your connected Instagram account
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-auto rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] transition-colors hover:border-[var(--accent)] disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {insightsPermissionDenied && !loading && !error ? (
          <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text)]">
            <p className="font-medium">Insights permission missing</p>
            <p className="mt-1 text-[var(--muted)]">
              Your access token does not include{' '}
              <code className="text-[var(--text)]">instagram_manage_insights</code>. Views, reshares,
              and avg watch time require it.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[var(--muted)]">
              <li>
                In Meta Developer Console → your app → App Review / Permissions, add{' '}
                <code className="text-[var(--text)]">instagram_manage_insights</code>.
              </li>
              <li>
                Regenerate the token with that scope (e.g. set{' '}
                <code className="text-[var(--text)]">META_SYSTEM_USER_SCOPES</code> to include it,
                then run <code className="text-[var(--text)]">npm run meta:system-user:generate</code>
                ).
              </li>
              <li>
                Update <code className="text-[var(--text)]">INSTAGRAM_GRAPH_ACCESS_TOKEN</code> in{' '}
                <code className="text-[var(--text)]">web/.env</code>, then verify with{' '}
                <code className="text-[var(--text)]">npm run check:instagram-token</code>.
              </li>
            </ol>
          </div>
        ) : insightsAvailable === false && !insightsPermissionDenied && !loading && !error ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            No insight metrics returned for these posts yet (they may be too recent).
          </p>
        ) : null}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        {error ? (
          <p className="text-sm text-[var(--bad)]">{error}</p>
        ) : loading && posts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Loading posts…</p>
        ) : posts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No posts found on this Instagram account.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                <tr>
                  <th className="p-2">Thumbnail</th>
                  <th className="p-2">Date posted</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Views</th>
                  <th className="p-2">Reshares</th>
                  <th className="p-2">Likes</th>
                  <th className="p-2">Comments</th>
                  <th className="p-2">Avg watch</th>
                  <th className="p-2">Instagram</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((row) => {
                  const badge = getFeedbackThumbnailBadge(row);
                  return (
                  <tr key={row.id} className="border-b border-[var(--border)]">
                    <td className="h-12 w-20 p-1">
                      {row.thumbnailUrl ? (
                        <a
                          href={row.permalink ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative block h-12 w-20 overflow-hidden rounded"
                          title="Open on Instagram"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={row.thumbnailUrl}
                            alt=""
                            className="h-12 w-20 object-cover"
                          />
                          {badge ? (
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] text-white">
                              {badge}
                            </span>
                          ) : null}
                        </a>
                      ) : (
                        <div className="flex h-12 w-20 items-center justify-center rounded bg-[var(--surface-2)] text-[10px] text-[var(--muted)]">
                          —
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-2 text-[var(--text)]">
                      {formatFeedbackDate(row.postedAt)}
                    </td>
                    <td className="p-2 text-[var(--muted)]">{row.postTypeLabel}</td>
                    <td className="p-2 tabular-nums text-[var(--text)]">
                      {formatFeedbackNumber(row.views)}
                    </td>
                    <td className="p-2 tabular-nums text-[var(--text)]">
                      {formatFeedbackNumber(row.shares)}
                    </td>
                    <td className="p-2 tabular-nums text-[var(--text)]">
                      {formatFeedbackNumber(row.likeCount)}
                    </td>
                    <td className="p-2 tabular-nums text-[var(--text)]">
                      {formatFeedbackNumber(row.commentsCount)}
                    </td>
                    <td className="p-2 tabular-nums text-[var(--text)]">
                      {formatAvgWatchTime(row.avgWatchTimeMs)}
                    </td>
                    <td className="p-2">
                      {row.permalink ? (
                        <a
                          href={row.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--accent)] underline hover:opacity-80"
                        >
                          Open
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
