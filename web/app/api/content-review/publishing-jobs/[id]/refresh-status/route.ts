import { NextRequest, NextResponse } from 'next/server';

import { refreshPublishingJobFromGraph } from '@fr94/publishing/publishing-state';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  try {
    const result = await refreshPublishingJobFromGraph(supabase, id);
    const { data: job, error } = await supabase.from('publishing_jobs').select('*').eq('id', id).maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ job, poll: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[refresh publishing]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
