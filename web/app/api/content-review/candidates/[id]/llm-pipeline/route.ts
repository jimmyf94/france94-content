import { NextRequest, NextResponse } from 'next/server';

import { buildCandidateLlmPipeline } from '@/lib/candidate-llm-pipeline';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('post_candidates')
    .select(
      'id, title, llm_model, llm_raw, created_at, last_regenerated_at, regeneration_count, reviewer_notes, source_asset_ids, previous_versions',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[candidate llm-pipeline]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
  }

  try {
    const pipeline = await buildCandidateLlmPipeline(supabase, data);
    return NextResponse.json(pipeline);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[candidate llm-pipeline] build', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
