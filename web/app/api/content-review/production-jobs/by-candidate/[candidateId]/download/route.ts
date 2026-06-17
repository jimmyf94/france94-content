import { NextRequest, NextResponse } from 'next/server';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ candidateId: string }> },
) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { candidateId } = await ctx.params;
  if (!candidateId?.trim()) {
    return NextResponse.json({ error: 'Missing candidate id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data: job, error } = await supabase
    .from('production_jobs')
    .select('status, output_video_url')
    .eq('post_candidate_id', candidateId.trim())
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[production-job download]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outputUrl =
    job?.status === 'produced' && typeof job.output_video_url === 'string'
      ? job.output_video_url.trim()
      : '';

  if (!outputUrl) {
    return NextResponse.json({ error: 'No rendered reel' }, { status: 404 });
  }

  return NextResponse.redirect(outputUrl, 302);
}
