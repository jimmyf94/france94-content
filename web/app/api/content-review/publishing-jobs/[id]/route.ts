import { NextRequest, NextResponse } from 'next/server';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

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
      'id, title, post_type, status, review_drive_folder_url, caption_fr, publishing_job_id, ready_to_publish_at',
    )
    .eq('id', job.post_candidate_id)
    .maybeSingle();

  if (cErr) {
    console.error('[publishing-job candidate]', cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  return NextResponse.json({ job, candidate });
}
