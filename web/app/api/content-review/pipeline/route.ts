import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const PIPELINE_SINGLETON = true;

type PipelineRow = {
  auto_ingest_enabled: boolean;
  auto_pause_threshold: number;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  last_run_summary: Record<string, unknown> | null;
  updated_at: string;
};

const patchBodySchema = z
  .object({
    auto_ingest_enabled: z.boolean().optional(),
    auto_pause_threshold: z.number().int().min(1).max(100).optional(),
  })
  .refine((b) => b.auto_ingest_enabled !== undefined || b.auto_pause_threshold !== undefined, {
    message: 'Provide auto_ingest_enabled and/or auto_pause_threshold',
  });

async function needsReviewCount(supabase: ReturnType<typeof getSupabaseServiceRole>): Promise<number> {
  const { count, error } = await supabase
    .from('post_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'needs_review');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function loadPipelineRow(
  supabase: ReturnType<typeof getSupabaseServiceRole>,
): Promise<PipelineRow> {
  const { data, error } = await supabase
    .from('pipeline_settings')
    .select(
      'auto_ingest_enabled,auto_pause_threshold,last_run_started_at,last_run_finished_at,last_run_status,last_run_summary,updated_at',
    )
    .eq('singleton', PIPELINE_SINGLETON)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error('pipeline_settings row missing; apply migration 20260513120000_pipeline_settings.sql');
  }
  return data as PipelineRow;
}

function toPayload(row: PipelineRow, needsReview: number) {
  return {
    auto_ingest_enabled: row.auto_ingest_enabled,
    auto_pause_threshold: row.auto_pause_threshold,
    needs_review_count: needsReview,
    last_run_started_at: row.last_run_started_at,
    last_run_finished_at: row.last_run_finished_at,
    last_run_status: row.last_run_status,
    last_run_summary: row.last_run_summary,
    updated_at: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const supabase = getSupabaseServiceRole();
    const [row, needsReview] = await Promise.all([loadPipelineRow(supabase), needsReviewCount(supabase)]);
    return NextResponse.json(toPayload(row, needsReview));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] GET', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const json: unknown = await req.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.auto_ingest_enabled !== undefined) {
      patch.auto_ingest_enabled = parsed.data.auto_ingest_enabled;
    }
    if (parsed.data.auto_pause_threshold !== undefined) {
      patch.auto_pause_threshold = parsed.data.auto_pause_threshold;
    }

    const supabase = getSupabaseServiceRole();
    const { error } = await supabase
      .from('pipeline_settings')
      .update(patch)
      .eq('singleton', PIPELINE_SINGLETON);

    if (error) {
      console.error('[pipeline] PATCH', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const [row, needsReview] = await Promise.all([loadPipelineRow(supabase), needsReviewCount(supabase)]);
    return NextResponse.json(toPayload(row, needsReview));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] PATCH', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
