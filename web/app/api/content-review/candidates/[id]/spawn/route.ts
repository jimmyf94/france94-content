import { NextRequest, NextResponse } from 'next/server';

import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import { parseSpawnRequest, spawnCandidateFromSource } from '@/lib/post-candidate-spawn';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: ReturnType<typeof parseSpawnRequest>;
  try {
    body = parseSpawnRequest(await req.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid body';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();

  try {
    const result = await spawnCandidateFromSource({
      supabase,
      sourceId: id,
      request: body,
    });

    const { data: created, error: fetchErr } = await supabase
      .from('post_candidates')
      .select(POST_CANDIDATE_DETAIL_COLUMNS)
      .eq('id', result.candidateId)
      .maybeSingle();

    if (fetchErr) {
      console.error('[candidate spawn] fetch created', fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    return NextResponse.json({
      candidate: created,
      spawn_mode: body.mode,
      render_queued: result.renderQueued,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidate spawn]', msg);
    const status = msg.includes('Cannot spawn') ? 400 : msg.includes('not found') ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
