import { NextRequest, NextResponse } from 'next/server';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

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
  const { data, error } = await supabase
    .from('production_jobs')
    .select(
      [
        'id',
        'status',
        'production_type',
        'output_video_url',
        'thumbnail_url',
        'error_message',
        'render_strategy',
        'render_log',
        'reel_specification',
        'updated_at',
      ].join(','),
    )
    .eq('post_candidate_id', candidateId.trim())
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[production-job by candidate]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ job: data });
}
