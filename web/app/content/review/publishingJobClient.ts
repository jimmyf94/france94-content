import type { PublishingJobDto } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

import { preparePublishingForCandidate } from './preparePublishingClient';

export { preparePublishingForCandidate };

export async function loadPublishingJobByCandidate(
  candidateId: string,
): Promise<PublishingJobDto | null> {
  const res = await fetch(
    `/api/content-review/publishing-jobs/by-candidate/${encodeURIComponent(candidateId)}`,
    { credentials: 'include' },
  );
  if (res.status === 404) return null;
  const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json.job ?? null;
}

export async function refreshPublishingJobStatus(jobId: string): Promise<PublishingJobDto> {
  const res = await fetch(
    `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/refresh-status`,
    { method: 'POST', credentials: 'include' },
  );
  const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
  if (!res.ok || !json.job) throw new Error(json.error || res.statusText);
  return json.job;
}

export async function schedulePublishingJob(
  jobId: string,
  scheduledPublishAt: string,
): Promise<PublishingJobDto> {
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
  if (!res.ok || !json.job) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return json.job;
}

export async function unschedulePublishingJob(jobId: string): Promise<PublishingJobDto> {
  const res = await fetch(
    `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/unschedule`,
    { method: 'POST', credentials: 'include' },
  );
  const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
  if (!res.ok || !json.job) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return json.job;
}

export async function publishPublishingJobNow(
  jobId: string,
  candidateId: string,
): Promise<PublishingJobDto> {
  const res = await fetch(
    `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/publish-now`,
    { method: 'POST', credentials: 'include' },
  );
  const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown; message?: string }>(
    res,
  );
  if (!res.ok || !json.job) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }

  let latest = json.job;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const polled = await loadPublishingJobByCandidate(candidateId);
    if (!polled) continue;
    latest = polled;
    if (polled.status === 'published' || polled.status === 'failed') return polled;
  }
  return latest;
}
