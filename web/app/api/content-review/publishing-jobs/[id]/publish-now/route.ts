import { NextRequest, NextResponse } from 'next/server';

import { updatePublishingJob } from '@fr94/publishing/publishing-state';

import { dispatchGithubWorkflow } from '@/lib/github-dispatch';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const PUBLISH_NOW_STATUSES = new Set([
  'draft',
  'media_prepared',
  'containers_created',
  'processing',
  'ready_to_publish',
  'scheduled',
]);

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(_req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: job, error: readErr } = await supabase
    .from('publishing_jobs')
    .select('id,status,scheduled_publish_at')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const st = String((job as { status?: string }).status ?? '');
  if (!PUBLISH_NOW_STATUSES.has(st)) {
    return NextResponse.json(
      { error: `Cannot publish now from status "${st}".` },
      { status: 409 },
    );
  }

  const nowIso = new Date().toISOString();
  try {
    await updatePublishingJob(supabase, id, {
      status: 'scheduled',
      scheduled_publish_at: nowIso,
      error_message: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[publish now] schedule patch', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const dispatch = await dispatchGithubWorkflow('publish-scheduled.yml');
  if (!dispatch.ok) {
    console.warn('[publish now] dispatch failed', dispatch.error);
  }

  const { data: updated, error: uErr } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: dispatch.ok
      ? 'Publish pipeline started'
      : 'Publish scheduled; worker will pick it up within ~5 minutes',
    dispatched: dispatch.ok,
    job: updated,
  });
}
