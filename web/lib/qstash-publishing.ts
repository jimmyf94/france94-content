import { Client } from '@upstash/qstash';

export type ScheduledPublishingPayload = {
  jobId: string;
  scheduledAt: string;
};

const CALLBACK_PATH = '/api/qstash/publishing-jobs/run';

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function normalizeBaseUrl(raw: string): string {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

export function resolveQstashCallbackUrl(): string | null {
  const explicit = env('QSTASH_CALLBACK_BASE_URL') ?? env('NEXT_PUBLIC_SITE_URL');
  if (explicit) return `${normalizeBaseUrl(explicit)}${CALLBACK_PATH}`;

  const vercelUrl = env('VERCEL_URL');
  if (vercelUrl) return `${normalizeBaseUrl(vercelUrl)}${CALLBACK_PATH}`;

  return null;
}

export async function schedulePublishingJob(params: {
  jobId: string;
  scheduledAt: string;
}): Promise<{ messageId: string | null }> {
  const { jobId, scheduledAt } = params;
  const token = env('QSTASH_TOKEN');
  if (!token) throw new Error('QSTASH_TOKEN is not configured');

  const url = resolveQstashCallbackUrl();
  if (!url) {
    throw new Error('QSTASH_CALLBACK_BASE_URL, NEXT_PUBLIC_SITE_URL, or VERCEL_URL is required');
  }

  const scheduledMs = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduledMs)) {
    throw new Error('scheduledAt must be a valid ISO datetime');
  }

  const client = new Client({ token });
  const response = await client.publishJSON<ScheduledPublishingPayload>({
    url,
    method: 'POST',
    body: { jobId, scheduledAt },
    notBefore: Math.max(Math.floor(scheduledMs / 1000), Math.floor(Date.now() / 1000)),
    retries: 5,
    deduplicationId: `publish:${jobId}:${scheduledAt}`,
    label: ['publishing', 'scheduled'],
  });

  const messageId =
    'messageId' in response && typeof response.messageId === 'string'
      ? response.messageId
      : null;
  return { messageId };
}
