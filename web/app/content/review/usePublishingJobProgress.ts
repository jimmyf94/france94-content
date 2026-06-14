'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PublishingJobDto } from '@/lib/publishing-types';
import {
  defaultPublishNowMessage,
  isPublishPipelineTerminal,
  type PublishNowFeedback,
  publishPipelineProgressLabel,
  showPublishPipelineProgress,
} from '@/lib/publishing-publish-feedback';

import { loadPublishingJobByCandidate, triggerPublishJobNow } from './publishingJobClient';

const POLL_MS = 3000;

export function usePublishingJobProgress(options: {
  job: PublishingJobDto | null;
  candidateId: string;
  onJobUpdate: (job: PublishingJobDto) => void;
}) {
  const { job, candidateId, onJobUpdate } = options;
  const [publishActing, setPublishActing] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<PublishNowFeedback | null>(null);

  useEffect(() => {
    if (job && isPublishPipelineTerminal(job.status)) {
      setPublishFeedback(null);
    }
  }, [job?.id, job?.status]);

  const shouldPoll = useMemo(() => {
    if (!job?.id || !publishFeedback) return false;
    return !isPublishPipelineTerminal(job.status);
  }, [job?.id, job?.status, publishFeedback]);

  useEffect(() => {
    if (!shouldPoll || !candidateId) return undefined;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const polled = await loadPublishingJobByCandidate(candidateId);
          if (polled) onJobUpdate(polled);
        } catch {
          /* best-effort */
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPoll, candidateId, onJobUpdate]);

  const publishNow = useCallback(async () => {
    if (!job?.id) return;
    setPublishActing(true);
    try {
      const result = await triggerPublishJobNow(job.id);
      setPublishFeedback({
        message: result.message,
        dispatched: result.dispatched,
        startedAt: new Date().toISOString(),
      });
      onJobUpdate(result.job);
    } finally {
      setPublishActing(false);
    }
  }, [job?.id, onJobUpdate]);

  const progressLabel = job
    ? publishPipelineProgressLabel(job.status, publishFeedback, publishActing)
    : publishFeedback?.message ?? defaultPublishNowMessage(publishFeedback?.dispatched ?? true);

  const showProgress = job
    ? showPublishPipelineProgress(job.status, publishFeedback, publishActing)
    : publishActing;

  return {
    publishActing,
    publishFeedback,
    publishNow,
    showProgress,
    progressLabel,
  };
}
