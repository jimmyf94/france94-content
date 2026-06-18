import { NextResponse } from 'next/server';
import { Receiver, SignatureError } from '@upstash/qstash';
import { z } from 'zod';

import { runDuePublishingJob } from '../../../../../../scripts/publish-scheduled-jobs';

import { resolveQstashCallbackUrl } from '@/lib/qstash-publishing';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const bodySchema = z.object({
  jobId: z.string().uuid(),
  scheduledAt: z.string().min(1),
});

const PUBLISHABLE_STATUSES = new Set([
  'scheduled',
  'media_prepared',
  'processing',
  'containers_created',
  'ready_to_publish',
]);

const RETRYABLE_STATUSES = new Set([
  'scheduled',
  'media_prepared',
  'processing',
  'containers_created',
  'ready_to_publish',
]);

async function verifyQstashRequest(req: Request, rawBody: string): Promise<NextResponse | null> {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!currentSigningKey || !nextSigningKey) {
    return NextResponse.json({ error: 'QStash signing keys are not configured' }, { status: 500 });
  }

  const signature = req.headers.get('upstash-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing QStash signature' }, { status: 401 });
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey });
  try {
    await receiver.verify({
      signature,
      body: rawBody,
      url: resolveQstashCallbackUrl() ?? undefined,
      clockTolerance: 300,
      upstashRegion: req.headers.get('upstash-region') ?? undefined,
    });
  } catch (e) {
    const msg = e instanceof SignatureError ? e.message : 'Invalid QStash signature';
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  return null;
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const denied = await verifyQstashRequest(req, rawBody);
  if (denied) return denied;

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { jobId, scheduledAt } = parsed.data;
  const scheduledMs = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduledMs)) {
    return NextResponse.json({ error: 'scheduledAt must be a valid ISO datetime' }, { status: 400 });
  }

  // QStash should not deliver early, but return a retryable response if clock skew does happen.
  if (scheduledMs - Date.now() > 30_000) {
    return NextResponse.json({ error: 'not_due_yet' }, { status: 425 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: before, error: readErr } = await supabase
    .from('publishing_jobs')
    .select('id,status,scheduled_publish_at')
    .eq('id', jobId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Publishing job not found' }, { status: 404 });
  }

  const beforeStatus = String((before as { status?: string }).status ?? '');
  if (beforeStatus === 'published') {
    return NextResponse.json({ ok: true, skipped: 'already_published' });
  }
  if (!PUBLISHABLE_STATUSES.has(beforeStatus)) {
    return NextResponse.json(
      { error: `Cannot publish scheduled job from status "${beforeStatus}".` },
      { status: 409 },
    );
  }

  const rowScheduledAt = (before as { scheduled_publish_at?: string | null }).scheduled_publish_at;
  if (rowScheduledAt) {
    const rowScheduledMs = Date.parse(rowScheduledAt);
    if (Number.isFinite(rowScheduledMs) && Math.abs(rowScheduledMs - scheduledMs) > 1000) {
      return NextResponse.json({ ok: true, skipped: 'stale_callback' });
    }
  }

  const result = await runDuePublishingJob(supabase, jobId);

  const { data: after, error: afterErr } = await supabase
    .from('publishing_jobs')
    .select('status,instagram_permalink,instagram_media_id,error_message')
    .eq('id', jobId)
    .maybeSingle();

  if (afterErr) {
    return NextResponse.json({ error: afterErr.message }, { status: 500 });
  }

  const afterStatus = String((after as { status?: string } | null)?.status ?? '');
  if (!result && RETRYABLE_STATUSES.has(afterStatus)) {
    return NextResponse.json(
      { error: 'publishing_not_ready', status: afterStatus },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    jobId,
    status: afterStatus || null,
    result,
    instagram_permalink:
      (after as { instagram_permalink?: string | null } | null)?.instagram_permalink ?? null,
    instagram_media_id:
      (after as { instagram_media_id?: string | null } | null)?.instagram_media_id ?? null,
    error_message:
      (after as { error_message?: string | null } | null)?.error_message ?? null,
  });
}
