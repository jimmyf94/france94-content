'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { PublishingJobDto } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

import { PublishingJobView } from '../PublishingJobView';
import { unstagePublishingJob, updateReelTrialStrategy } from '../../review/publishingJobClient';
import type { ReelTrialGraduationStrategy } from '@/lib/reel-trial-types';

type CandidateBrief = {
  id: string;
  title: string | null;
  post_type: string;
  status: string;
  review_drive_folder_url: string | null;
};

export function PublishingDetailClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [job, setJob] = useState<PublishingJobDto | null>(null);
  const [candidate, setCandidate] = useState<CandidateBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [publishingActing, setPublishingActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}`, {
        credentials: 'include',
      });
      const json = await readJsonResponse<{
        job?: PublishingJobDto;
        candidate?: CandidateBrief;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setJob(json.job ?? null);
      setCandidate(json.candidate ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshGraph = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/refresh-status`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.job) setJob(json.job as PublishingJobDto);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const schedulePublish = async (scheduledPublishAt: string) => {
    setPublishingActing(true);
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
      if (json.job) setJob(json.job as PublishingJobDto);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  const unschedulePublish = async () => {
    setPublishingActing(true);
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
      if (json.job) setJob(json.job as PublishingJobDto);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  const publishNow = async () => {
    setPublishingActing(true);
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
      if (json.job) setJob(json.job as PublishingJobDto);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  const unstagePublish = async () => {
    setPublishingActing(true);
    setError(null);
    try {
      await unstagePublishingJob(jobId);
      router.push('/content/review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  const updateReelTrial = async (strategy: ReelTrialGraduationStrategy | null) => {
    setPublishingActing(true);
    setError(null);
    try {
      setJob(await updateReelTrialStrategy(jobId, strategy));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishingActing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-[var(--text)]">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/content/review"
          className="text-sm text-[var(--accent)] underline hover:opacity-80"
        >
          Back to review
        </Link>
      </div>

      <h1 className="text-xl font-semibold tracking-tight">Publishing prep</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Instagram permalink is only available after publish. Review prepared media and container
        status here.
      </p>

      {loading && <p className="mt-6 text-sm text-[var(--muted)]">Loading…</p>}
      {error && (
        <p className="mt-6 text-sm text-[var(--bad)]">{error}</p>
      )}

      {!loading && job && (
        <div className="mt-6 space-y-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Candidate
            </p>
            <p className="mt-1 text-lg font-medium">{candidate?.title || '(untitled)'}</p>
            <p className="text-xs text-[var(--muted)]">
              {candidate?.post_type} · {candidate?.status}
            </p>
          </div>

          <PublishingJobView
            variant="detailPage"
            job={job}
            refreshing={refreshing}
            onRefreshGraph={refreshGraph}
            reviewDriveFolderUrl={candidate?.review_drive_folder_url}
            publishingActing={publishingActing}
            onSchedulePublish={schedulePublish}
            onUnschedulePublish={unschedulePublish}
            onPublishNow={publishNow}
            onUnstagePublish={unstagePublish}
            onUpdateReelTrial={updateReelTrial}
          />
        </div>
      )}
    </div>
  );
}
