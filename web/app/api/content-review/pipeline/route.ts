import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  loadPipelineRow,
  needsReviewCount,
  PIPELINE_POST_TYPES,
  recoverStalePipelineRun,
  toPipelinePayload,
  PIPELINE_SINGLETON_KEY,
} from '@/lib/pipeline-settings-server';
import { assertReviewAuthorized } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

const pipelinePostTypeSchema = z.enum(PIPELINE_POST_TYPES);

const patchBodySchema = z
  .object({
    auto_ingest_enabled: z.boolean().optional(),
    auto_pause_threshold: z.number().int().min(1).max(100).optional(),
    auto_ingest_interval_minutes: z.number().int().min(5).max(60 * 24 * 30).optional(),
    enabled_post_types: z.array(pipelinePostTypeSchema).min(0).optional(),
    auto_reel_render_enabled: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.auto_ingest_enabled !== undefined ||
      b.auto_pause_threshold !== undefined ||
      b.auto_ingest_interval_minutes !== undefined ||
      b.enabled_post_types !== undefined ||
      b.auto_reel_render_enabled !== undefined,
    {
      message:
        'Provide auto_ingest_enabled, auto_pause_threshold, auto_ingest_interval_minutes, enabled_post_types, and/or auto_reel_render_enabled',
    },
  );

export async function GET(req: NextRequest) {
  try {
    const denied = assertReviewAuthorized(req);
    if (denied) return denied;

    const supabase = getSupabaseServiceRole();
    const [rawRow, needsReview] = await Promise.all([loadPipelineRow(supabase), needsReviewCount(supabase)]);
    const row = await recoverStalePipelineRun(supabase, rawRow);
    return NextResponse.json(toPipelinePayload(row, needsReview));
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
    if (parsed.data.auto_ingest_interval_minutes !== undefined) {
      patch.auto_ingest_interval_minutes = parsed.data.auto_ingest_interval_minutes;
    }
    if (parsed.data.enabled_post_types !== undefined) {
      patch.enabled_post_types = parsed.data.enabled_post_types;
    }
    if (parsed.data.auto_reel_render_enabled !== undefined) {
      patch.auto_reel_render_enabled = parsed.data.auto_reel_render_enabled;
    }

    const supabase = getSupabaseServiceRole();
    const { error } = await supabase
      .from('pipeline_settings')
      .update(patch)
      .eq('singleton', PIPELINE_SINGLETON_KEY);

    if (error) {
      console.error('[pipeline] PATCH', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const [rawRow, needsReview] = await Promise.all([loadPipelineRow(supabase), needsReviewCount(supabase)]);
    const row = await recoverStalePipelineRun(supabase, rawRow);
    return NextResponse.json(toPipelinePayload(row, needsReview));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pipeline] PATCH', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
