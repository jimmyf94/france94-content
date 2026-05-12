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
  if (!candidateId) {
    return NextResponse.json({ error: 'Missing candidate id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('post_candidate_id', candidateId)
    .maybeSingle();

  if (error) {
    console.error('[publishing-job by candidate]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ job: data });
}
