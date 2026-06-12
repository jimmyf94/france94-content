'use client';

import { useCallback, useEffect, useState } from 'react';

import type { PublishingJobDto } from '@/lib/publishing-types';

import { PublishingJobView } from '../publishing/PublishingJobView';
import { notifyScheduleQueueChanged } from '../schedule-events';
import {
  loadPublishingJobByCandidate,
  preparePublishingForCandidate,
  publishPublishingJobNow,
  refreshPublishingJobStatus,
  schedulePublishingJob,
  unschedulePublishingJob,
} from './publishingJobClient';
import type { PostCandidate } from './types';

export function CandidatePublishingPopover({
  open,
  onClose,
  candidate,
  onUpdated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  candidate: PostCandidate;
  onUpdated?: () => void;
  onError?: (message: string) => void;
}) {
  const [job, setJob] = useState<PublishingJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [staging, setStaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);

  const refreshQueue = useCallback(() => {
    notifyScheduleQueueChanged();
    onUpdated?.();
  }, [onUpdated]);

  const loadJob = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadPublishingJobByCandidate(candidate.id);
      setJob(loaded);
      return loaded;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [candidate.id]);

  useEffect(() => {
    if (!open) {
      setJob(null);
      setError(null);
      return;
    }

    void (async () => {
      const existing = await loadJob();
      if (existing || candidate.publishing_job_id) return;

      if (candidate.status !== 'approved') return;

      setStaging(true);
      try {
        const staged = await preparePublishingForCandidate(candidate.id);
        if (staged) {
          setJob(staged);
          refreshQueue();
        } else {
          await loadJob();
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        onError?.(message);
      } finally {
        setStaging(false);
      }
    })();
  }, [open, candidate.id, candidate.publishing_job_id, candidate.status, loadJob, refreshQueue]);

  const refreshGraph = async () => {
    if (!job?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      const updated = await refreshPublishingJobStatus(job.id);
      setJob(updated);
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const schedulePublish = async (iso: string) => {
    if (!job?.id) return;
    setActing(true);
    setError(null);
    try {
      const updated = await schedulePublishingJob(job.id, iso);
      setJob(updated);
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const unschedulePublish = async () => {
    if (!job?.id) return;
    setActing(true);
    setError(null);
    try {
      const updated = await unschedulePublishingJob(job.id);
      setJob(updated);
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  };

  const publishNow = async () => {
    if (!job?.id) return;
    setActing(true);
    setError(null);
    try {
      const updated = await publishPublishingJobNow(job.id, candidate.id);
      setJob(updated);
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
      void loadJob();
    }
  };

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/50"
        aria-label="Close publishing"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text)]">Publish</h2>
              <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">
                {candidate.title || '(untitled)'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="cockpit-btn-secondary shrink-0 px-2.5 py-1 text-xs"
            >
              Close
            </button>
          </div>
        </div>

        <div className="scrollbar-thin flex-1 overflow-auto p-4">
          {(loading || staging) && (
            <p className="text-sm text-[var(--muted)]">
              {staging ? 'Staging for publishing…' : 'Loading…'}
            </p>
          )}
          {error && <p className="text-sm text-[var(--bad)]">{error}</p>}
          {!loading && !staging && !job && !error && (
            <p className="text-sm text-[var(--muted)]">No publishing job for this candidate yet.</p>
          )}
          {job && (
            <PublishingJobView
              variant="popup"
              job={job}
              refreshing={refreshing}
              onRefreshGraph={refreshGraph}
              publishingActing={acting}
              onSchedulePublish={schedulePublish}
              onUnschedulePublish={unschedulePublish}
              onPublishNow={publishNow}
            />
          )}
        </div>
      </aside>
    </>
  );
}
