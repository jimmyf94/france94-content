'use client';

import { useEffect, useState } from 'react';

import type { PublishingQueueItem } from '@/lib/publishing-types';

import { BottomSheet } from '../review/mobile/BottomSheet';
import { PublishingCaptionEditor } from './PublishingCaptionEditor';
import { ScheduleControls } from './ScheduleControls';
import {
  invalidatePublishingJobDetail,
  usePublishingJobDetail,
} from './usePublishingJobDetail';
import {
  canPublishPublishingJobNow,
  canSchedulePublishingJob,
  canUnschedulePublishingJob,
  canUnstagePublishingJob,
} from '../review/publishingJobStatuses';
import { PostTypeBadge } from '../review/PostTypeBadge';
import { postTypeKey } from '../review/postTypeTheme';

const POST_TYPE_INITIAL: Record<string, string> = {
  reel: 'R',
  carousel: 'C',
  story_sequence: 'S',
  static_post: 'P',
};

function postTypeInitial(type: string): string {
  return POST_TYPE_INITIAL[type] ?? type.slice(0, 1).toUpperCase();
}

function statusTone(status: string): string {
  if (status === 'ready_to_publish' || status === 'scheduled') return 'text-[var(--good)]';
  if (status === 'publishing') return 'text-[var(--warn)]';
  if (status === 'failed') return 'text-[var(--bad)]';
  return 'text-[var(--muted)]';
}

function QueueThumbnail({ item }: { item: PublishingQueueItem }) {
  const url = item.thumbnail_url;
  const k = postTypeKey(item.candidate.post_type);
  const shell =
    'h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]';
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [url]);

  if (url && !imgFailed) {
    return (
      <div className={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      data-post-type={k}
      className={`post-type-avatar flex items-center justify-center text-lg font-semibold uppercase ${shell}`}
    >
      {postTypeInitial(item.candidate.post_type)}
    </div>
  );
}

export function PublishingQueueRow({
  item,
  acting,
  onSchedule,
  onUnschedule,
  onPublishNow,
  onUnstage,
  compact = true,
  showScheduleControls = true,
  showCaptionEdit = true,
  onSelectCandidate,
  selected = false,
  onContentUpdated,
  showScheduledTime,
}: {
  item: PublishingQueueItem;
  acting: boolean;
  onSchedule: (jobId: string, iso: string) => void | Promise<void>;
  onUnschedule: (jobId: string) => void | Promise<void>;
  onPublishNow: (jobId: string) => void | Promise<void>;
  onUnstage?: (jobId: string) => void | Promise<void>;
  compact?: boolean;
  showScheduleControls?: boolean;
  showCaptionEdit?: boolean;
  onSelectCandidate?: (candidateId: string) => void;
  selected?: boolean;
  onContentUpdated?: () => void;
  showScheduledTime?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const { detail, loading: detailLoading, load, invalidate } = usePublishingJobDetail(item.id);

  const canSetSchedule = canSchedulePublishingJob(item.status);
  const canUnschedule = canUnschedulePublishingJob(item.status);
  const canPublishNow = canPublishPublishingJobNow(item.status);
  const canUnstage = canUnstagePublishingJob(item.status);

  const handleUnstage = () => {
    if (
      !window.confirm(
        'Remove this post from the publishing queue and return it to review? This cannot be undone.',
      )
    ) {
      return;
    }
    void onUnstage?.(item.id);
  };

  const openEdit = () => {
    setEditOpen(true);
    void load();
  };

  const closeEdit = () => {
    setEditOpen(false);
  };

  const handleCaptionSaved = () => {
    invalidatePublishingJobDetail(item.id);
    invalidate();
    void load();
    onContentUpdated?.();
    closeEdit();
  };

  const captionFr = detail?.candidate?.caption_fr ?? null;
  const captionEn = detail?.candidate?.caption_en ?? null;
  const captionTags = detail?.candidate?.hashtags ?? null;

  const actionBtnClass =
    'min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 sm:min-h-0 sm:px-2 sm:py-1 sm:text-[10px]';

  return (
    <>
      <li
        className={`rounded-xl border p-3 transition-colors ${
          selected
            ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
            : 'border-[var(--border)] bg-[var(--surface-2)]/60'
        }`}
      >
        <div className="flex gap-3">
          <QueueThumbnail item={item} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PostTypeBadge postType={item.candidate.post_type} />
                  <span className={`text-[10px] font-semibold uppercase ${statusTone(item.status)}`}>
                    {item.status.replace(/_/g, ' ')}
                  </span>
                  {showScheduledTime && (
                    <span className="text-xs font-semibold tabular-nums text-[var(--accent)]">
                      {showScheduledTime}
                    </span>
                  )}
                </div>
                {onSelectCandidate ? (
                  <button
                    type="button"
                    onClick={() => onSelectCandidate(item.post_candidate_id)}
                    className="mt-1 line-clamp-2 text-left text-sm font-medium leading-snug hover:text-[var(--accent)]"
                  >
                    {item.candidate.title || '(untitled)'}
                  </button>
                ) : (
                  <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">
                    {item.candidate.title || '(untitled)'}
                  </p>
                )}
              </div>
              {showCaptionEdit && (
                <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-auto sm:items-end">
                  <button
                    type="button"
                    disabled={acting}
                    onClick={openEdit}
                    className={`${actionBtnClass} w-full text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] sm:w-auto`}
                    aria-label="Edit post"
                  >
                    Edit post
                  </button>
                  {onUnstage && (
                    <button
                      type="button"
                      disabled={acting || !canUnstage}
                      onClick={handleUnstage}
                      title={canUnstage ? undefined : 'Cancel schedule before unstaging'}
                      className={`${actionBtnClass} w-full font-medium text-[var(--muted)] hover:border-[var(--bad)]/50 hover:text-[var(--bad)] sm:w-auto`}
                    >
                      Unstage
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {item.status === 'scheduled' ? (
                <span>Scheduled — change time or cancel below</span>
              ) : item.status === 'ready_to_publish' ? (
                <span>Ready — set a go-live time below</span>
              ) : canSetSchedule ? (
                <span>Prep in progress — schedule below</span>
              ) : (
                <span>In progress ({item.publish_type})</span>
              )}
            </p>
          </div>
        </div>

        {showScheduleControls && (canSetSchedule || canUnschedule || canPublishNow) && (
          <div className="mt-2 border-t border-[var(--border)] pt-2">
            <ScheduleControls
              scheduledAt={item.scheduled_publish_at}
              canSetSchedule={canSetSchedule}
              canUnschedule={canUnschedule}
              canPublishNow={canPublishNow}
              acting={acting}
              compact={compact}
              layout="queue"
              onSchedule={(iso) => void onSchedule(item.id, iso)}
              onUnschedule={() => void onUnschedule(item.id)}
              onPublishNow={() => void onPublishNow(item.id)}
            />
          </div>
        )}
      </li>

      <BottomSheet open={editOpen} onClose={closeEdit} title="Edit post">
        <div className="scrollbar-thin overflow-auto p-4">
          {detailLoading && !detail ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : (
            <PublishingCaptionEditor
              candidateId={item.post_candidate_id}
              initialCaptionFr={captionFr}
              initialCaptionEn={captionEn}
              initialHashtags={captionTags}
              onSaved={handleCaptionSaved}
              onCancel={closeEdit}
            />
          )}
        </div>
      </BottomSheet>
    </>
  );
}

export function PublishingQueueThumbnail({ item }: { item: PublishingQueueItem }) {
  return <QueueThumbnail item={item} />;
}
