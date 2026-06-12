import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { parseReelTrialGraduationStrategy } from '@fr94/publishing/reel-publish';
import { updatePublishingJob } from '@fr94/publishing/publishing-state';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const patchSchema = z.object({
  reel_trial_graduation_strategy: z.enum(['MANUAL', 'SS_PERFORMANCE']).nullable(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: job, error: jobErr } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (jobErr) {
    console.error('[publishing-job]', jobErr);
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select(
      'id, title, post_type, status, review_drive_folder_url, caption_fr, caption_en, hashtags, publishing_job_id, ready_to_publish_at',
    )
    .eq('id', job.post_candidate_id)
    .maybeSingle();

  if (cErr) {
    console.error('[publishing-job candidate]', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  return NextResponse.json({ job, candidate });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: job, error: readErr } = await supabase
    .from('publishing_jobs')
    .select('id, publish_type, status, instagram_creation_id')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const publishType = String((job as { publish_type?: string }).publish_type ?? '');
  if (publishType !== 'reel') {
    return NextResponse.json(
      { error: 'Trial reel settings apply to reel publish jobs only.' },
      { status: 409 },
    );
  }

  const creationId = (job as { instagram_creation_id?: string | null }).instagram_creation_id;
  if (typeof creationId === 'string' && creationId.trim()) {
    return NextResponse.json(
      {
        error:
          'Instagram container already created. Unstage this post before changing trial reel settings.',
      },
      { status: 409 },
    );
  }

  const strategy = parseReelTrialGraduationStrategy(parsed.data.reel_trial_graduation_strategy);

  try {
    await updatePublishingJob(supabase, id, {
      reel_trial_graduation_strategy: strategy,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: updated, error: uErr } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ job: updated });
}
