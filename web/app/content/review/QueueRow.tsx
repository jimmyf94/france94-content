'use client';

import { memo, useCallback, useEffect, useState } from 'react';

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

function PostTypeAvatar({
  candidate,
  thumbnailUrl,
}: {
  candidate: CandidateListItem;
  thumbnailUrl: string | null;
}) {
  const k = postTypeKey(candidate.post_type);
  const shell =
    'h-12 w-12 shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)]';
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [thumbnailUrl]);

  const showImg = thumbnailUrl && !imgFailed;

  if (showImg) {
    return (
      <div className={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }
  return (
    <div
      data-post-type={k}
      className={`post-type-avatar flex h-12 w-12 items-center justify-center text-sm font-semibold uppercase ${shell}`}
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
  firstThumbnailUrl: string | null;
}) {
  const handleClick = useCallback(() => {
    onSelect(candidate.id);
  }, [onSelect, candidate.id]);

  const priority =
    candidate.priority_score != null
      ? Number(candidate.priority_score).toFixed(1)
      : null;

  const conflict = candidate.has_asset_conflict === true;
  const stale = Boolean(candidate.freshness_warning);
  const risk = (candidate.collision_risk ?? '').trim();
  const riskGreyed = risk === 'blocked' || risk === 'high';
  const hasPublishing =
    Boolean(candidate.publishing_job_id) || candidate.status === 'ready_to_publish';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-start gap-2.5 rounded-lg border px-2 py-2 text-left transition-colors ${
        conflict || stale || riskGreyed ? 'opacity-55' : ''
      } ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-muted)] ring-1 ring-[var(--ring)]'
          : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-2)]'
      }`}
    >
      <PostTypeAvatar candidate={candidate} thumbnailUrl={firstThumbnailUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <PostTypeBadge postType={candidate.post_type} />
          {priority != null && (
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--accent)]">
              {priority}
            </span>
          )}
        </div>
        <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">
          {candidate.title || '(untitled)'}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {hasPublishing && (
            <span className="cockpit-pill text-[9px] text-[var(--good)]">Publish</span>
          )}
          {stale && <span className="cockpit-pill text-[9px] text-[var(--warn)]">Stale</span>}
          {conflict && <span className="cockpit-pill text-[9px] text-[var(--bad)]">Conflict</span>}
          {risk === 'high' || risk === 'blocked' ? (
            <span className="cockpit-pill text-[9px] capitalize">{risk}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
});
