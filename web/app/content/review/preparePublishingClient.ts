import type { PublishingJobDto } from '@/lib/publishing-types';
import { readJsonResponse } from '@/lib/read-json-response';

export async function preparePublishingForCandidate(
  candidateId: string,
): Promise<PublishingJobDto | null> {
  const res = await fetch(
    `/api/content-review/candidates/${encodeURIComponent(candidateId)}/prepare-publishing`,
    { method: 'POST', credentials: 'include' },
  );
  const json = await readJsonResponse<{ ok?: boolean; error?: string; message?: string }>(res);
  if (!res.ok) throw new Error(json.error || res.statusText);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await fetch(
      `/api/content-review/publishing-jobs/by-candidate/${encodeURIComponent(candidateId)}`,
      { credentials: 'include' },
    );
    if (poll.status === 404) continue;
    const pollJson = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(poll);
    if (!poll.ok) throw new Error(pollJson.error || poll.statusText);
    if (pollJson.job) return pollJson.job;
  }

  return null;
}
