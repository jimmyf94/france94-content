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
  stage: z.enum(['full', 'candidates_only', 'assets_only']),
  series_slug: z.string().trim().min(1).optional(),
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

    const supabase = getSupabaseServiceRole();
    const seriesSlug = parsed.data.series_slug?.trim() || null;

    if (seriesSlug) {
      const { data: seriesRow, error: seriesError } = await supabase
        .from('content_series')
        .select('slug, status')
        .eq('slug', seriesSlug)
        .maybeSingle();

      if (seriesError) {
        console.error('[pipeline/run] content_series lookup', seriesError);
        return NextResponse.json({ error: seriesError.message }, { status: 500 });
      }
      if (!seriesRow) {
        return NextResponse.json({ error: `Series not found: ${seriesSlug}` }, { status: 404 });
      }
      if (seriesRow.status !== 'active') {
        return NextResponse.json(
          { error: `Series is not active: ${seriesSlug}` },
          { status: 400 },
        );
      }
    }

    const workflowInputs: Record<string, string> = { stage: parsed.data.stage };
    if (seriesSlug) workflowInputs.series_slug = seriesSlug;

    const dispatch = await dispatchGithubWorkflow('auto-ingest.yml', workflowInputs);
    if (!dispatch.ok) {
      return NextResponse.json({ error: dispatch.error }, { status: dispatch.status });
    }

    const dispatchedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('pipeline_settings')
      .update({
        last_run_status: 'dispatching',
        last_run_summary: {
          stage: parsed.data.stage,
          dispatched_at: dispatchedAt,
          ...(seriesSlug ? { series_slug: seriesSlug } : {}),
        },
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
