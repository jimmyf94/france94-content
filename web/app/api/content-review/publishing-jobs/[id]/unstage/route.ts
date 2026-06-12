import { NextRequest, NextResponse } from 'next/server';

import {
  UnstagePublishingJobError,
  unstagePublishingJob,
} from '@fr94/publishing/unstage-publishing-job';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * Full unstage: delete publishing job, revert candidate, release job-scoped asset locks.
 * Instagram Graph containers are not deleted (expire ~24h; re-staging creates fresh ones).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(_req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  try {
    const result = await unstagePublishingJob(supabase, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof UnstagePublishingJobError) {
      const status =
        e.code === 'not_found' ? 404
        : e.code === 'blocked_status' ? 409
        : 500;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[unstage publishing]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
