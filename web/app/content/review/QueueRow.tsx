'use client';

import { PostTypeBadge } from './PostTypeBadge';
import type { PostCandidate } from './types';
import { postTypeKey } from './postTypeTheme';
import { useCandidateMedia } from './useCandidateMedia';

const POST_TYPE_INITIAL: Record<string, string> = {
  reel: 'R',
  carousel: 'C',
  story_sequence: 'S',
  static_post: 'P',
};

function postTypeInitial(type: string): string {
  return POST_TYPE_INITIAL[type] ?? type.slice(0, 1).toUpperCase();
}

/** Hours while under 24h, then whole days. */
function formatCreatedAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const ms = Date.now() - t;
  if (ms < 0) return '';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(ms / 86400000);
  if (h < 24) {
    if (h < 1) return '<1h ago';
    return `${h}h ago`;
  }
  return `${d}d ago`;
}

function PostTypeAvatar({
  candidate,
  thumbnailUrl,
}: {
  candidate: PostCandidate;
  thumbnailUrl: string | null;
}) {
  const k = postTypeKey(candidate.post_type);

  if (thumbnailUrl) {
    return (
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      data-post-type={k}
      className="post-type-avatar flex h-24 w-24 shrink-0 items-center justify-center rounded-lg text-2xl font-semibold uppercase"
    >
      {postTypeInitial(candidate.post_type)}
    </div>
  );
}

export function QueueRow({
  candidate,
  selected,
  onClick,
}: {
  candidate: PostCandidate;
  selected: boolean;
  onClick: () => void;
}) {
  const { files } = useCandidateMedia(candidate.id);
  const firstThumb = files.find((f) => f.thumbnailLink)?.thumbnailLink ?? null;
  const age = formatCreatedAge(candidate.created_at);
  const priority =
    candidate.priority_score != null
      ? Number(candidate.priority_score).toFixed(1)
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-[color:rgb(91_140_255_/0.55)] bg-[var(--surface-2)] ring-1 ring-[var(--ring)]'
          : 'border-[color:rgb(42_49_66_/0.55)] hover:border-[color:rgb(58_66_88_/0.9)] hover:bg-[var(--surface-2)]/60'
      }`}
    >
      <PostTypeAvatar candidate={candidate} thumbnailUrl={firstThumb} />
      <div className="min-w-0 flex-1 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <PostTypeBadge postType={candidate.post_type} />
            {age && (
              <span className="text-[11px] tabular-nums text-[var(--muted)]">{age}</span>
            )}
          </div>
          {priority != null && (
            <span className="shrink-0 text-sm font-medium tabular-nums text-amber-200">
              {priority}
            </span>
          )}
        </div>
        <div className="mt-2 line-clamp-2 text-base font-medium leading-snug">
          {candidate.title || '(untitled)'}
        </div>
        {candidate.hook && (
          <div className="mt-1.5 line-clamp-2 text-sm leading-snug text-[var(--muted)]">
            {candidate.hook}
          </div>
        )}
      </div>
    </button>
  );
}
