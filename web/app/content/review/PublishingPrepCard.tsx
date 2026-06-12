'use client';

import { useCallback, useEffect, useState } from 'react';

import type { PublishingJobDto } from '@/lib/publishing-types';
import { canOpenPublishingForCandidate } from '@/lib/publishing-staging';
import type { ReelTrialGraduationStrategy } from '@/lib/reel-trial-types';

import { PublishingJobView, statusTone } from '../publishing/PublishingJobView';
import { notifyScheduleQueueChanged } from '../schedule-events';

import {
  loadPublishingJobByCandidate,
  publishPublishingJobNow,
  refreshPublishingJobStatus,
  schedulePublishingJob,
  unschedulePublishingJob,
  updateReelTrialStrategy,
} from './publishingJobClient';
import type { PostCandidate } from './types';

export function PublishingPrepCard({
  candidate,
  onRefreshQueue,
  compact = false,
}: {
  candidate: PostCandidate;
  reviewDriveFolderUrl?: string | null;
  onRefreshQueue?: () => void;
  compact?: boolean;
}) {
  const show =
    canOpenPublishingForCandidate(candidate.status) || Boolean(candidate.publishing_job_id);

  const [job, setJob] = useState<PublishingJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [publishingActing, setPublishingActing] = useState(false);

  const refreshQueue = useCallback(() => {
    notifyScheduleQueueChanged();
    onRefreshQueue?.();
  }, [onRefreshQueue]);

  const load = useCallback(async () => {
    if (
      !candidate.publishing_job_id &&
      !canOpenPublishingForCandidate(candidate.status)
    ) {
      setJob(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setJob(await loadPublishingJobByCandidate(candidate.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [candidate.id, candidate.publishing_job_id, candidate.status]);

  useEffect(() => {
    if (!show) {
      setJob(null);
      return;
    }
    void load();
  }, [show, load]);

  const refreshGraph = async () => {
    if (!job?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      setJob(await refreshPublishingJobStatus(job.id));
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const schedulePublish = async (scheduledPublishAt: string) => {
    if (!job?.id) return;
    setPublishingActing(true);
    setError(null);
    try {
      setJob(await schedulePublishingJob(job.id, scheduledPublishAt));
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  const unschedulePublish = async () => {
    if (!job?.id) return;
    setPublishingActing(true);
    setError(null);
    try {
      setJob(await unschedulePublishingJob(job.id));
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  const publishNow = async () => {
    if (!job?.id) return;
    setPublishingActing(true);
    setError(null);
    try {
      setJob(await publishPublishingJobNow(job.id, candidate.id));
      refreshQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
      void load();
    }
  };

  const updateReelTrial = async (strategy: ReelTrialGraduationStrategy | null) => {
    if (!job?.id) return;
    setPublishingActing(true);
    setError(null);
    try {
      setJob(await updateReelTrialStrategy(job.id, strategy));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  if (!show) return null;

  return (
    <section className={compact ? 'cockpit-card p-3' : 'shrink-0 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 lg:px-6'}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Publishing
      </h3>

      {loading && <p className="mt-2 text-xs text-[var(--muted)]">Loading publishing job…</p>}
      {error && <p className="mt-2 text-xs text-[var(--bad)]">{error}</p>}

      {!loading && !job && canOpenPublishingForCandidate(candidate.status) && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Use the share icon in the action bar to stage and publish.
        </p>
      )}

      {job && compact && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`font-semibold ${statusTone(job.status)}`}>{job.status}</span>
          <span className="text-[var(--muted)]">· {job.publish_type}</span>
        </div>
      )}

      {job && !compact && (
        <PublishingJobView
          variant="prepCard"
          job={job}
          refreshing={refreshing}
          onRefreshGraph={refreshGraph}
          publishingActing={publishingActing}
          onSchedulePublish={schedulePublish}
          onUnschedulePublish={unschedulePublish}
          onPublishNow={publishNow}
          onUpdateReelTrial={updateReelTrial}
        />
      )}
    </section>
  );
}
