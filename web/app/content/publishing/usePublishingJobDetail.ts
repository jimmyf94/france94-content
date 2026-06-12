'use client';

import { useCallback, useRef, useState } from 'react';

import type { PublishingJobDto } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

export type PublishingJobDetailCandidate = {
  id: string;
  title: string | null;
  post_type: string;
  status: string;
  review_drive_folder_url: string | null;
  caption_fr: string | null;
  caption_en: string | null;
  hashtags: string[] | null;
  publishing_job_id: string | null;
  ready_to_publish_at: string | null;
};

export type PublishingJobDetail = {
  job: PublishingJobDto;
  candidate: PublishingJobDetailCandidate | null;
};

const detailCache = new Map<string, PublishingJobDetail>();

export function usePublishingJobDetail(jobId: string) {
  const cached = detailCache.get(jobId);
  const [detail, setDetail] = useState<PublishingJobDetail | null>(cached ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<PublishingJobDetail | null> | null>(null);

  const load = useCallback(async (): Promise<PublishingJobDetail | null> => {
    const hit = detailCache.get(jobId);
    if (hit) {
      setDetail(hit);
      return hit;
    }

    if (inflight.current) {
      return inflight.current;
    }

    setLoading(true);
    setError(null);

    const promise = (async () => {
      try {
        const res = await fetch(
          `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}`,
          { credentials: 'include', cache: 'no-store' },
        );
        const json = await readJsonResponse<{
          job?: PublishingJobDto;
          candidate?: PublishingJobDetailCandidate | null;
          error?: string;
        }>(res);
        if (!res.ok || !json.job) {
          throw new Error(json.error || res.statusText);
        }
        const next: PublishingJobDetail = {
          job: json.job,
          candidate: json.candidate ?? null,
        };
        detailCache.set(jobId, next);
        setDetail(next);
        return next;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        return null;
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();

    inflight.current = promise;
    return promise;
  }, [jobId]);

  const invalidate = useCallback(() => {
    detailCache.delete(jobId);
    setDetail(null);
  }, [jobId]);

  return { detail, loading, error, load, invalidate };
}

export function invalidatePublishingJobDetail(jobId: string): void {
  detailCache.delete(jobId);
}
