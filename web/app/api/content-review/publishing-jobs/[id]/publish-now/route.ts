import { NextRequest, NextResponse } from 'next/server';

import { publishPublishingJob } from '@fr94/publishing/publish';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(_req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  try {
    const result = await publishPublishingJob(supabase, id);
    const { data: job, error } = await supabase.from('publishing_jobs').select('*').eq('id', id).maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ job, publish: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[publish now]', msg);
    const httpStatus = /not publishable/i.test(msg) ? 409 : 500;
    const { data: job } = await supabase.from('publishing_jobs').select('*').eq('id', id).maybeSingle();
    return NextResponse.json({ error: msg, job }, { status: httpStatus });
  }
}
