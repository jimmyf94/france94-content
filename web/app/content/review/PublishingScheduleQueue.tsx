'use client';

import { useEffect } from 'react';

import { PublishingQueueRow } from '../publishing/PublishingQueueRow';
import { usePublishingScheduleQueue } from '../publishing/usePublishingScheduleQueue';

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
  const {
    items,
    loading,
    error,
    actingJobId,
    publishActingJobId,
    publishFeedbackByJobId,
    load,
    schedulePublish,
    unschedulePublish,
    unstagePublish,
    publishNow,
  } = usePublishingScheduleQueue(reloadNonce);

  useEffect(() => {
    onStatsChange?.({
      scheduled: items.filter((i) => i.status === 'scheduled').length,
      ready: items.filter((i) => i.status === 'ready_to_publish').length,
    });
  }, [items, onStatsChange]);

  const handleSchedule = async (jobId: string, iso: string) => {
    await schedulePublish(jobId, iso);
    onRefresh?.();
  };

  const handleUnschedule = async (jobId: string) => {
    await unschedulePublish(jobId);
    onRefresh?.();
  };

  const handlePublishNow = async (jobId: string) => {
    await publishNow(jobId);
    onRefresh?.();
  };

  const handleUnstage = async (jobId: string) => {
    await unstagePublish(jobId);
    onRefresh?.();
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
              <PublishingQueueRow
                key={item.id}
                item={item}
                acting={actingJobId === item.id}
                publishActing={publishActingJobId === item.id}
                publishFeedback={publishFeedbackByJobId[item.id] ?? null}
                onSchedule={handleSchedule}
                onUnschedule={handleUnschedule}
                onPublishNow={handlePublishNow}
                onUnstage={handleUnstage}
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
