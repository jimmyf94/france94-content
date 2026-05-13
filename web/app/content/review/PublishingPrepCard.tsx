'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { PublishingJobDto } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

import { PublishingJobView } from '../publishing/PublishingJobView';

import type { PostCandidate } from './types';

export function PublishingPrepCard({
  candidate,
  reviewDriveFolderUrl,
  onRefreshQueue,
}: {
  candidate: PostCandidate;
  reviewDriveFolderUrl: string | null;
  onRefreshQueue?: () => void;
}) {
  const show =
    candidate.status === 'approved' ||
    candidate.status === 'ready_to_publish' ||
    Boolean(candidate.publishing_job_id);

  const [job, setJob] = useState<PublishingJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [publishingActing, setPublishingActing] = useState(false);

  const load = useCallback(async () => {
    if (!candidate.publishing_job_id && candidate.status !== 'approved' && candidate.status !== 'ready_to_publish') {
      setJob(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/by-candidate/${encodeURIComponent(candidate.id)}`,
        { credentials: 'include' },
      );
      if (res.status === 404) {
        setJob(null);
        return;
      }
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setJob(json.job ?? null);
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
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(job.id)}/refresh-status`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.job) setJob(json.job as PublishingJobDto);
      onRefreshQueue?.();
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
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(job.id)}/schedule`,
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
      if (json.job) setJob(json.job as PublishingJobDto);
      onRefreshQueue?.();
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
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(job.id)}/unschedule`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      if (json.job) setJob(json.job as PublishingJobDto);
      onRefreshQueue?.();
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
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(job.id)}/publish-now`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      if (json.job) setJob(json.job as PublishingJobDto);
      onRefreshQueue?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  if (!show) return null;

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Publishing prep
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Instagram permalink is only available after publish. Review prepared media and container
            status here. Containers expire after ~24h per Meta.
          </p>
        </div>
        {job?.id && (
          <Link
            href={`/content/publishing/${job.id}`}
            className="shrink-0 text-xs font-medium text-[var(--accent)] underline hover:opacity-80"
          >
            Open publishing detail
          </Link>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-[var(--muted)]">Loading publishing job…</p>}
      {error && (
        <p className="mt-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      )}

      {!loading && !job && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          No publishing job yet. Run{' '}
          <code className="rounded bg-[var(--surface)] px-1 py-0.5 text-[10px]">
            npm run prepare:publishing
          </code>{' '}
          after approving this candidate.
        </p>
      )}

      {job && (
        <PublishingJobView
          variant="prepCard"
          job={job}
          refreshing={refreshing}
          onRefreshGraph={refreshGraph}
          reviewDriveFolderUrl={reviewDriveFolderUrl}
          publishingActing={publishingActing}
          onSchedulePublish={schedulePublish}
          onUnschedulePublish={unschedulePublish}
          onPublishNow={publishNow}
        />
      )}
    </section>
  );
}
