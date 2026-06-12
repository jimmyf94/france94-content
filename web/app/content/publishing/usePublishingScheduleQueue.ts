'use client';

import { useCallback, useEffect, useState } from 'react';

import type { PublishingJobDto, PublishingQueueItem } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

import { notifyScheduleQueueChanged } from '../schedule-events';

export function usePublishingScheduleQueue(reloadNonce = 0) {
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

  const refreshAll = useCallback(async () => {
    notifyScheduleQueueChanged();
    await load();
  }, [load]);

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
      await refreshAll();
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
      await refreshAll();
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
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingJobId(null);
    }
  };

  const unstagePublish = async (jobId: string) => {
    setActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/unstage`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ ok?: boolean; error?: unknown }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingJobId(null);
    }
  };

  return {
    items,
    loading,
    error,
    actingJobId,
    load,
    schedulePublish,
    unschedulePublish,
    unstagePublish,
    publishNow,
  };
}
