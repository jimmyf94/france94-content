'use client';

import type { CandidateInstagramFeedback } from './types';

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatWatchTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${(sec / 60).toFixed(1)}m`;
}

export function PublishedFeedbackStrip({
  feedback,
  permalink,
  publishedAt,
  compact = false,
}: {
  feedback: CandidateInstagramFeedback | null | undefined;
  permalink?: string | null;
  publishedAt?: string | null;
  compact?: boolean;
}) {
  const link = feedback?.permalink ?? permalink ?? null;
  const posted = feedback?.posted_at ?? publishedAt ?? null;

  if (!feedback && !link && !posted) {
    return (
      <p className="text-[11px] text-[var(--muted)]">
        No Instagram feedback linked yet.
      </p>
    );
  }

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {posted && (
        <p className="text-[10px] text-[var(--muted)]">
          Posted {new Date(posted).toLocaleString()}
        </p>
      )}
      {feedback && (
        <div className="flex flex-wrap gap-1.5 text-[10px] tabular-nums text-[var(--text)]">
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
            ♥ {formatCount(feedback.like_count)}
          </span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
            💬 {formatCount(feedback.comments_count)}
          </span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
            👁 {formatCount(feedback.views)}
          </span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
            ↗ {formatCount(feedback.shares)}
          </span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5">
            ⏱ {formatWatchTime(feedback.avg_watch_time_ms)}
          </span>
        </div>
      )}
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] text-[var(--accent)] underline-offset-2 hover:underline"
        >
          View on Instagram
        </a>
      )}
    </div>
  );
}
