'use client';

import type { AssetListRow } from '@/lib/asset-library-types';

import { AssetMediaThumb } from './AssetMediaThumb';
import { EligibilityBadge } from './EligibilityBadge';

function displayName(row: AssetListRow): string {
  return (
    row.final_filename?.trim() ||
    row.current_filename?.trim() ||
    row.original_filename?.trim() ||
    row.drive_file_id
  );
}

export function AssetCard({
  row,
  onOpenDetail,
  onSetEligibility,
  onManualUsage,
  onPostAsReel,
  onOpenDrive,
}: {
  row: AssetListRow;
  onOpenDetail: () => void;
  onSetEligibility: (
    el: 'eligible' | 'stale' | 'excluded' | 'manual_only' | 'needs_review',
  ) => void;
  onManualUsage: (kind: 'manual_post' | 'manual_story' | 'manual_reel') => void;
  onPostAsReel?: () => void;
  onOpenDrive: () => void;
}) {
  const isVideo = (row.mime_type ?? row.media_type ?? '').toLowerCase().startsWith('video');

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        className="relative block aspect-video w-full bg-[var(--bg)] text-left"
        onClick={onOpenDetail}
      >
        <AssetMediaThumb
          thumbnail_link={row.thumbnail_link}
          poster_url={row.poster_url}
          still_url={row.still_url}
          isVideo={isVideo}
        />
        {isVideo ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
            VIDEO
          </span>
        ) : null}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-2">
        <button
          type="button"
          className="truncate text-left text-xs font-medium text-[var(--text)] hover:underline"
          onClick={onOpenDetail}
          title={displayName(row)}
        >
          {displayName(row)}
        </button>
        <div className="flex flex-wrap items-center gap-1">
          <EligibilityBadge value={row.candidate_eligibility} />
          <span className="text-[10px] text-[var(--muted)]">{row.media_type ?? '—'}</span>
        </div>
        <div className="text-[10px] text-[var(--muted)]">
          {row.activity ?? '—'} · {row.content_lane ?? '—'}
        </div>
        <div className="text-[10px] text-[var(--muted)]">
          Q {row.quality_score ?? '—'} · used {row.usage_count ?? 0} · sug {row.suggestion_count ?? 0}
        </div>
        {row.last_used_at ? (
          <div className="text-[10px] text-[var(--muted)]">Last used {row.last_used_at}</div>
        ) : null}

        <div className="mt-auto flex flex-wrap gap-1 border-t border-[var(--border)] pt-2">
          <select
            className="max-w-full flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-1 text-[10px] text-[var(--text)]"
            aria-label="Quick actions"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = '';
              if (!v) return;
              if (v === 'eligible' || v === 'stale' || v === 'excluded' || v === 'manual_only' || v === 'needs_review') {
                onSetEligibility(v);
                return;
              }
              if (v === 'drive') {
                onOpenDrive();
                return;
              }
              if (v === 'history') {
                onOpenDetail();
                return;
              }
              if (v === 'manual_post' || v === 'manual_story' || v === 'manual_reel') {
                onManualUsage(v);
              }
              if (v === 'post_as_reel') {
                onPostAsReel?.();
              }
            }}
          >
            <option value="">Actions…</option>
            {isVideo ? <option value="post_as_reel">Post as reel…</option> : null}
            <option value="eligible">Mark eligible</option>
            <option value="stale">Mark stale</option>
            <option value="excluded">Exclude</option>
            <option value="manual_only">Manual only</option>
            <option value="needs_review">Needs review</option>
            <option value="manual_post">Manual post…</option>
            <option value="manual_story">Manual story…</option>
            <option value="manual_reel">Manual reel…</option>
            <option value="drive">Open Drive</option>
            <option value="history">View history</option>
          </select>
        </div>
      </div>
    </article>
  );
}
