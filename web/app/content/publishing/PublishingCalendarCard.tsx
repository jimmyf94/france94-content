'use client';

import { useEffect, useRef, useState } from 'react';

import type { PublishingJobDto, PublishingQueueItem } from '@/lib/publishing-types';

import { formatScheduledTime } from './publishingQueueSplit';
import { PublishingCaptionEditor } from './PublishingCaptionEditor';
import { ScheduleControls } from './ScheduleControls';
import {
  invalidatePublishingJobDetail,
  usePublishingJobDetail,
} from './usePublishingJobDetail';
import { PostTypeBadge } from '../review/PostTypeBadge';
import { canUnstagePublishingJob } from '../review/publishingJobStatuses';
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

function CompactQueueThumbnail({ item }: { item: PublishingQueueItem }) {
  const url = item.thumbnail_url;
  const k = postTypeKey(item.candidate.post_type);
  const shell =
    'h-8 w-8 shrink-0 overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-2)]';
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
      className={`post-type-avatar flex items-center justify-center text-[10px] font-semibold uppercase ${shell}`}
    >
      {postTypeInitial(item.candidate.post_type)}
    </div>
  );
}

function IconMore({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

function sortedPreparedMedia(job: PublishingJobDto) {
  if (!job.prepared_media?.length) return [];
  return [...job.prepared_media].sort((a, b) => a.order - b.order);
}

function CalendarCardHoverPanel({
  item,
  detail,
  loading,
  error,
}: {
  item: PublishingQueueItem;
  detail: ReturnType<typeof usePublishingJobDetail>['detail'];
  loading: boolean;
  error: string | null;
}) {
  const job = detail?.job;
  const candidate = detail?.candidate;
  const media = job ? sortedPreparedMedia(job) : [];
  const caption = job?.caption?.trim() || candidate?.caption_fr?.trim() || null;
  const hashtags = candidate?.hashtags?.filter(Boolean) ?? [];
  const driveUrl = candidate?.review_drive_folder_url;

  return (
    <div className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 opacity-0 shadow-xl transition-opacity group-hover/card:pointer-events-auto group-hover/card:visible group-hover/card:opacity-100">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Post detail
      </p>

      {loading && !detail && (
        <p className="text-xs text-[var(--muted)]">Loading detail…</p>
      )}
      {error && !detail && <p className="text-xs text-[var(--bad)]">{error}</p>}

      {(media.length > 0 || item.thumbnail_url) && (
        <div className="mb-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Assets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {media.length > 0
              ? media.map((m, i) =>
                  m.media_type === 'video' ? (
                    <video
                      key={`${m.public_url}-${i}`}
                      src={m.public_url}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-16 w-12 rounded border border-[var(--border)] bg-black object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${m.public_url}-${i}`}
                      src={m.public_url}
                      alt=""
                      loading="lazy"
                      className="h-16 w-12 rounded border border-[var(--border)] object-cover"
                    />
                  ),
                )
              : item.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnail_url}
                    alt=""
                    className="h-16 w-12 rounded border border-[var(--border)] object-cover"
                  />
                )}
          </div>
        </div>
      )}

      {caption && (
        <div className="mb-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Caption
          </p>
          <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed text-[var(--text)]">
            {caption}
          </p>
        </div>
      )}

      {hashtags.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Hashtags
          </p>
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            {hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ')}
          </p>
        </div>
      )}

      {driveUrl && (
        <a
          href={driveUrl}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto text-[11px] text-[var(--accent)] underline hover:opacity-80"
        >
          Open review folder
        </a>
      )}

      {!loading && !caption && hashtags.length === 0 && media.length === 0 && !item.thumbnail_url && (
        <p className="text-xs text-[var(--muted)]">No detail available yet.</p>
      )}
    </div>
  );
}

export function PublishingCalendarCard({
  item,
  acting,
  onSchedule,
  onUnschedule,
  onUnstage,
  onContentUpdated,
}: {
  item: PublishingQueueItem;
  acting: boolean;
  onSchedule: (jobId: string, iso: string) => void | Promise<void>;
  onUnschedule: (jobId: string) => void | Promise<void>;
  onUnstage?: (jobId: string) => void | Promise<void>;
  onContentUpdated?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPanel, setMenuPanel] = useState<'main' | 'schedule' | 'caption'>('main');
  const { detail, loading, error, load, invalidate } = usePublishingJobDetail(item.id);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setMenuPanel('main');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const handleMouseEnter = () => {
    void load();
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setMenuPanel('main');
  };

  const handleSchedule = async (iso: string) => {
    invalidatePublishingJobDetail(item.id);
    await onSchedule(item.id, iso);
    closeMenu();
  };

  const handleUnschedule = async () => {
    invalidatePublishingJobDetail(item.id);
    await onUnschedule(item.id);
    closeMenu();
  };

  const handleCaptionSaved = () => {
    invalidatePublishingJobDetail(item.id);
    invalidate();
    void load();
    onContentUpdated?.();
    closeMenu();
  };

  const captionFr = detail?.candidate?.caption_fr ?? null;
  const captionEn = detail?.candidate?.caption_en ?? null;
  const captionTags = detail?.candidate?.hashtags ?? null;
  const canUnstage = canUnstagePublishingJob(item.status);

  const handleUnstage = () => {
    if (
      !window.confirm(
        'Remove this post from the publishing queue and return it to review? This cannot be undone.',
      )
    ) {
      return;
    }
    invalidatePublishingJobDetail(item.id);
    void onUnstage?.(item.id);
    closeMenu();
  };

  return (
    <div
      className="group/card relative rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1.5"
      onMouseEnter={handleMouseEnter}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <CompactQueueThumbnail item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <p className="min-w-0 flex-1 line-clamp-2 text-[11px] font-medium leading-snug text-[var(--text)]">
              {item.candidate.title || '(untitled)'}
            </p>
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => {
                  if (menuOpen) {
                    closeMenu();
                  } else {
                    setMenuOpen(true);
                    setMenuPanel('main');
                    void load();
                  }
                }}
                className="inline-flex items-center justify-center rounded p-0.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
                aria-label="Post actions"
                aria-expanded={menuOpen}
              >
                <IconMore />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-[60] mt-1 w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 shadow-xl">
                  {menuPanel === 'main' && (
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => setMenuPanel('schedule')}
                        className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                      >
                        Edit schedule
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => setMenuPanel('caption')}
                        className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                      >
                        Edit caption
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void handleUnschedule()}
                        className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--bad)] hover:bg-[var(--bad)]/10 disabled:opacity-50"
                      >
                        Cancel schedule
                      </button>
                      {onUnstage && (
                        <button
                          type="button"
                          disabled={acting || !canUnstage}
                          onClick={() => void handleUnstage()}
                          title={canUnstage ? undefined : 'Cancel schedule before unstaging'}
                          className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-[var(--muted)] hover:bg-[var(--surface)] disabled:opacity-50"
                        >
                          Unstage
                        </button>
                      )}
                    </div>
                  )}
                  {menuPanel === 'schedule' && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setMenuPanel('main')}
                        className="text-[10px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        ← Back
                      </button>
                      <ScheduleControls
                        scheduledAt={item.scheduled_publish_at}
                        canSetSchedule
                        canUnschedule={false}
                        canPublishNow={false}
                        acting={acting}
                        compact
                        layout="queue"
                        onSchedule={(iso) => void handleSchedule(iso)}
                        onUnschedule={() => {}}
                        onPublishNow={() => {}}
                      />
                    </div>
                  )}
                  {menuPanel === 'caption' && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setMenuPanel('main')}
                        className="text-[10px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        ← Back
                      </button>
                      {loading && !detail ? (
                        <p className="text-xs text-[var(--muted)]">Loading caption…</p>
                      ) : (
                        <PublishingCaptionEditor
                          candidateId={item.post_candidate_id}
                          initialCaptionFr={captionFr}
                          initialCaptionEn={captionEn}
                          initialHashtags={captionTags}
                          onSaved={handleCaptionSaved}
                          onCancel={() => setMenuPanel('main')}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
            <PostTypeBadge
              postType={item.candidate.post_type}
              className="max-w-[55%] truncate px-1.5 py-0 text-[9px]"
            />
            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[var(--accent)]">
              {formatScheduledTime(item.scheduled_publish_at ?? '')}
            </span>
          </div>
        </div>
      </div>

      <CalendarCardHoverPanel
        item={item}
        detail={detail}
        loading={loading}
        error={error}
      />
    </div>
  );
}
