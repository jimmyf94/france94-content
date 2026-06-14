import type { PublishingJobDto } from '@/lib/publishing-types';
import type { ReelTrialGraduationStrategy } from '@/lib/reel-trial-types';
import { readJsonResponse } from '@/lib/read-json-response';

import { preparePublishingForCandidate } from './preparePublishingClient';

export { preparePublishingForCandidate };

export async function updateReelTrialStrategy(
  jobId: string,
  strategy: ReelTrialGraduationStrategy | null,
): Promise<PublishingJobDto> {
  const res = await fetch(
    `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reel_trial_graduation_strategy: strategy }),
    },
  );
  const json = await readJsonResponse<{ job?: PublishingJobDto; error?: unknown }>(res);
  if (!res.ok || !json.job) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return json.job;
}

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

export type UnstagePublishingJobResult = {
  ok: boolean;
  candidate_id: string;
  reverted_status: string;
};

export async function unstagePublishingJob(jobId: string): Promise<UnstagePublishingJobResult> {
  const res = await fetch(
    `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/unstage`,
    { method: 'POST', credentials: 'include' },
  );
  const json = await readJsonResponse<UnstagePublishingJobResult & { error?: unknown }>(res);
  if (!res.ok || !json.candidate_id) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return json;
}

export async function triggerPublishJobNow(jobId: string): Promise<{
  job: PublishingJobDto;
  message: string;
  dispatched: boolean;
}> {
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
  if (!res.ok || !json.job) {
    const err = json.error;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  const dispatched = json.dispatched ?? false;
  const message =
    typeof json.message === 'string' && json.message.trim()
      ? json.message.trim()
      : dispatched
        ? 'Publishing pipeline started. Waiting for Instagram…'
        : 'Publish scheduled. Worker will pick it up within ~5 minutes.';
  return { job: json.job, message, dispatched };
}

export async function publishPublishingJobNow(
  jobId: string,
  candidateId: string,
): Promise<PublishingJobDto> {
  const { job } = await triggerPublishJobNow(jobId);

  let latest = job;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const polled = await loadPublishingJobByCandidate(candidateId);
    if (!polled) continue;
    latest = polled;
    if (polled.status === 'published' || polled.status === 'failed') return polled;
  }
  return latest;
}
