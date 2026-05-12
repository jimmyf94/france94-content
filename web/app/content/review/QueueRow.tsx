'use client';

import { memo, useCallback } from 'react';

import { PostTypeBadge } from './PostTypeBadge';
import type { CandidateListItem } from './types';
import { postTypeKey } from './postTypeTheme';

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
  className = 'h-24 w-24 shrink-0',
}: {
  candidate: CandidateListItem;
  thumbnailUrl: string | null;
  /** Tall queue thumbs use e.g. `h-[98%] min-h-[4rem] w-full shrink-0`. */
  className?: string;
}) {
  const k = postTypeKey(candidate.post_type);
  const shell = `overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] ${className}`;

  if (thumbnailUrl) {
    return (
      <div className={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      data-post-type={k}
      className={`post-type-avatar flex items-center justify-center text-2xl font-semibold uppercase ${shell}`}
    >
      {postTypeInitial(candidate.post_type)}
    </div>
  );
}

export const QueueRow = memo(function QueueRow({
  candidate,
  selected,
  onSelect,
  firstThumbnailUrl,
}: {
  candidate: CandidateListItem;
  selected: boolean;
  onSelect: (id: string) => void;
  /** From bulk Drive listing; null until loaded or if no thumbnail. */
  firstThumbnailUrl: string | null;
}) {
  const handleClick = useCallback(() => {
    onSelect(candidate.id);
  }, [onSelect, candidate.id]);

  const dbAssetLen =
    candidate.source_asset_ids?.length ?? candidate.source_drive_file_ids?.length ?? null;
  const assetCount = typeof dbAssetLen === 'number' && dbAssetLen > 0 ? dbAssetLen : null;
  const age = formatCreatedAge(candidate.created_at);
  const priority =
    candidate.priority_score != null
      ? Number(candidate.priority_score).toFixed(1)
      : null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`grid w-full grid-cols-[7rem_minmax(0,1fr)] items-stretch gap-3 rounded-xl border p-4 text-left transition-colors ${
        selected
          ? 'border-[color:rgb(91_140_255_/0.55)] bg-[var(--surface-2)] ring-1 ring-[var(--ring)]'
          : 'border-[color:rgb(42_49_66_/0.55)] hover:border-[color:rgb(58_66_88_/0.9)] hover:bg-[var(--surface-2)]/60'
      }`}
    >
      {/* Grid row height follows text column; this column fills it so % height resolves. */}
      <div className="flex h-full min-h-[5rem] w-[7rem] flex-col justify-center justify-self-start">
        <PostTypeAvatar
          candidate={candidate}
          thumbnailUrl={firstThumbnailUrl}
          className="h-[98%] min-h-[4.5rem] w-full shrink-0"
        />
      </div>
      <div className="min-w-0 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <PostTypeBadge postType={candidate.post_type} />
            <span
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--muted)]"
              title="Source assets on this candidate"
            >
              {assetCount != null
                ? `${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`
                : '—'}
            </span>
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
});
