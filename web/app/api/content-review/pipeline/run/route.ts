import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { dispatchGithubWorkflow } from '@/lib/github-dispatch';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

import {
  loadPipelineRow,
  needsReviewCount,
  PIPELINE_SINGLETON_KEY,
  toPipelinePayload,
} from '@/lib/pipeline-settings-server';

const runBodySchema = z.object({
  stage: z.enum(['full', 'candidates_only']),
});

export async function POST(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const json: unknown = await req.json().catch(() => null);
    const parsed = runBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const dispatch = await dispatchGithubWorkflow('auto-ingest.yml', { stage: parsed.data.stage });
    if (!dispatch.ok) {
      return NextResponse.json({ error: dispatch.error }, { status: dispatch.status });
    }

    const supabase = getSupabaseServiceRole();
    const dispatchedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('pipeline_settings')
      .update({
        last_run_status: 'dispatching',
        last_run_summary: { stage: parsed.data.stage, dispatched_at: dispatchedAt },
        updated_at: dispatchedAt,
      })
      .eq('singleton', PIPELINE_SINGLETON_KEY);

    if (updateError) {
      console.error('[pipeline/run] pipeline_settings update', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const [row, needsReview] = await Promise.all([loadPipelineRow(supabase), needsReviewCount(supabase)]);
    return NextResponse.json(toPipelinePayload(row, needsReview));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline/run] POST', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
