'use client';

import { useCallback, useEffect, useState } from 'react';

import type { PublishingJobDto, PublishingQueueItem } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

import { ScheduleControls } from '../publishing/ScheduleControls';
import {
  canPublishPublishingJobNow,
  canSchedulePublishingJob,
  canUnschedulePublishingJob,
} from './publishingJobStatuses';
import { PostTypeBadge } from './PostTypeBadge';
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

function ScheduleQueueRow({
  item,
  acting,
  onSchedule,
  onUnschedule,
  onPublishNow,
  compact,
  onSelectCandidate,
  selected,
}: {
  item: PublishingQueueItem;
  acting: boolean;
  onSchedule: (jobId: string, iso: string) => void | Promise<void>;
  onUnschedule: (jobId: string) => void | Promise<void>;
  onPublishNow: (jobId: string) => void | Promise<void>;
  compact?: boolean;
  onSelectCandidate?: (candidateId: string) => void;
  selected?: boolean;
}) {
  const canSetSchedule = canSchedulePublishingJob(item.status);
  const canUnschedule = canUnschedulePublishingJob(item.status);
  const canPublishNow = canPublishPublishingJobNow(item.status);

  return (
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
          <div className="flex flex-wrap items-center gap-1.5">
            <PostTypeBadge postType={item.candidate.post_type} />
            <span className={`text-[10px] font-semibold uppercase ${statusTone(item.status)}`}>
              {item.status.replace(/_/g, ' ')}
            </span>
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

      {(canSetSchedule || canUnschedule || canPublishNow) && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <ScheduleControls
            scheduledAt={item.scheduled_publish_at}
            canSetSchedule={canSetSchedule}
            canUnschedule={canUnschedule}
            canPublishNow={canPublishNow}
            acting={acting}
            compact
            layout="queue"
            onSchedule={(iso) => void onSchedule(item.id, iso)}
            onUnschedule={() => void onUnschedule(item.id)}
            onPublishNow={() => void onPublishNow(item.id)}
          />
        </div>
      )}
    </li>
  );
}

export function PublishingScheduleQueue({
  variant = 'column',
  reloadNonce = 0,
  hideHeader = false,
  onStatsChange,
  onRefresh,
  onSelectCandidate,
  selectedCandidateId,
}: {
  variant?: 'column' | 'page';
  reloadNonce?: number;
  hideHeader?: boolean;
  onStatsChange?: (stats: { scheduled: number; ready: number }) => void;
  onRefresh?: () => void;
  onSelectCandidate?: (candidateId: string) => void;
  selectedCandidateId?: string | null;
}) {
  const [items, setItems] = useState<PublishingQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingJobId, setActingJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-review/publishing-jobs', {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await readJsonResponse<{ items?: PublishingQueueItem[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadNonce]);

  useEffect(() => {
    onStatsChange?.({
      scheduled: items.filter((i) => i.status === 'scheduled').length,
      ready: items.filter((i) => i.status === 'ready_to_publish').length,
    });
  }, [items, onStatsChange]);

  const patchJobFromResponse = (job: PublishingJobDto) => {
    setItems((prev) =>
      prev.map((row) =>
        row.id === job.id
          ? {
              ...row,
              status: job.status,
              scheduled_publish_at: job.scheduled_publish_at,
              published_at: job.published_at,
              instagram_permalink: job.instagram_permalink,
            }
          : row,
      ),
    );
  };

  const schedulePublish = async (jobId: string, scheduledPublishAt: string) => {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/schedule`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduled_publish_at: scheduledPublishAt }),
        },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      if (json.job) patchJobFromResponse(json.job);
      onRefresh?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingJobId(null);
    }
  };

  const unschedulePublish = async (jobId: string) => {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/unschedule`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      if (json.job) patchJobFromResponse(json.job);
      onRefresh?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingJobId(null);
    }
  };

  const publishNow = async (jobId: string) => {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/publish-now`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      if (json.job) patchJobFromResponse(json.job);
      onRefresh?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingJobId(null);
    }
  };

  const isPage = variant === 'page';
  const scheduledCount = items.filter((i) => i.status === 'scheduled').length;
  const readyCount = items.filter((i) => i.status === 'ready_to_publish').length;
  const showHeader = !hideHeader;

  return (
    <div
      className={
        isPage
          ? 'mx-auto max-w-2xl px-4 py-6 text-[var(--text)]'
          : 'flex min-h-0 flex-1 flex-col bg-[var(--surface)]'
      }
    >
      {showHeader && (
        <div
          className={
            isPage
              ? 'mb-4 flex flex-wrap items-baseline justify-between gap-2'
              : 'flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--border)] px-3 pt-3 pb-2'
          }
        >
          <div>
            <h2
              className={
                isPage
                  ? 'text-lg font-semibold tracking-tight'
                  : 'text-sm font-semibold tracking-tight'
              }
            >
              Publishing queue
            </h2>
            {!isPage && (
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                {scheduledCount} scheduled · {readyCount} ready
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      )}

      {error && (
        <p className={`text-xs text-[var(--bad)] ${isPage ? 'mb-3' : 'px-3 py-2'}`}>{error}</p>
      )}

      <div
        className={
          isPage
            ? ''
            : 'scrollbar-thin flex min-h-0 flex-1 flex-col overflow-hidden'
        }
      >
        {loading && items.length === 0 && (
          <p className={`text-sm text-[var(--muted)] ${isPage ? '' : 'p-3'}`}>Loading…</p>
        )}
        {!loading && items.length === 0 && (
          <p className={`text-sm text-[var(--muted)] ${isPage ? '' : 'p-3'}`}>
            No posts queued to go live.
          </p>
        )}
        {items.length > 0 && (
          <ul
            className={
              isPage
                ? 'flex list-none flex-col gap-3'
                : 'scrollbar-thin flex min-h-0 flex-1 list-none flex-col gap-2 overflow-auto p-2.5'
            }
            role="list"
          >
            {items.map((item) => (
              <ScheduleQueueRow
                key={item.id}
                item={item}
                acting={actingJobId === item.id}
                onSchedule={schedulePublish}
                onUnschedule={unschedulePublish}
                onPublishNow={publishNow}
                compact={!isPage}
                onSelectCandidate={onSelectCandidate}
                selected={selectedCandidateId === item.post_candidate_id}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
