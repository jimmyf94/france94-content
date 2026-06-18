'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PublishingJobDto, PublishingQueueItem } from '@/lib/publishing-types';
import {
  defaultPublishNowMessage,
  isPublishPipelineTerminal,
  type PublishNowFeedback,
} from '@/lib/publishing-publish-feedback';
import { readJsonResponse } from '@/lib/read-json-response';

import { notifyScheduleQueueChanged } from '../schedule-events';

const POLL_INTERVAL_MS = 5000;

export function usePublishingScheduleQueue(reloadNonce = 0) {
  const [items, setItems] = useState<PublishingQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingJobId, setActingJobId] = useState<string | null>(null);
  const [publishActingJobId, setPublishActingJobId] = useState<string | null>(null);
  const [publishFeedbackByJobId, setPublishFeedbackByJobId] = useState<
    Record<string, PublishNowFeedback>
  >({});

  const syncPublishFeedback = useCallback(
    (nextItems: PublishingQueueItem[], prevFeedback: Record<string, PublishNowFeedback>) => {
      const nextFeedback = { ...prevFeedback };
      for (const [jobId] of Object.entries(prevFeedback)) {
        const item = nextItems.find((row) => row.id === jobId);
        if (!item || isPublishPipelineTerminal(item.status)) {
          delete nextFeedback[jobId];
        }
      }
      return nextFeedback;
    },
    [],
  );

  const loadItems = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch('/api/content-review/publishing-jobs', {
          credentials: 'include',
          cache: 'no-store',
        });
        const json = await readJsonResponse<{ items?: PublishingQueueItem[]; error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        const nextItems = json.items ?? [];
        setItems(nextItems);
        setPublishFeedbackByJobId((prev) => syncPublishFeedback(nextItems, prev));
      } catch (e) {
        if (!silent) {
          setError(e instanceof Error ? e.message : String(e));
          setItems([]);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [syncPublishFeedback],
  );

  const load = useCallback(async () => {
    await loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadItems();
  }, [loadItems, reloadNonce]);

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
    await loadItems();
  }, [loadItems]);

  const pollingJobIds = useMemo(
    () =>
      Object.keys(publishFeedbackByJobId).filter((jobId) => {
        const item = items.find((row) => row.id === jobId);
        return item != null && !isPublishPipelineTerminal(item.status);
      }),
    [publishFeedbackByJobId, items],
  );

  useEffect(() => {
    if (pollingJobIds.length === 0) return undefined;
    const tick = () => {
      if (!document.hidden) void loadItems({ silent: true });
    };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void loadItems({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadItems, pollingJobIds.length]);

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
    setPublishActingJobId(jobId);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/publish-now`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{
        job?: PublishingJobDto;
        error?: unknown;
        message?: string;
        dispatched?: boolean;
      }>(res);
      if (!res.ok) {
        const err = json.error;
        throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
      }

      const dispatched = json.dispatched ?? false;
      const message =
        typeof json.message === 'string' && json.message.trim()
          ? json.message.trim()
          : defaultPublishNowMessage(dispatched);

      setPublishFeedbackByJobId((prev) => ({
        ...prev,
        [jobId]: {
          message,
          dispatched,
          startedAt: new Date().toISOString(),
        },
      }));

      if (json.job) patchJobFromResponse(json.job);
      await loadItems({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActingJobId(null);
      setPublishActingJobId(null);
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
      setPublishFeedbackByJobId((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
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
    publishActingJobId,
    publishFeedbackByJobId,
    load,
    schedulePublish,
    unschedulePublish,
    unstagePublish,
    publishNow,
  };
}
