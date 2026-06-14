import type { getSupabaseServiceRole } from '@/lib/supabase-server';

const PIPELINE_SINGLETON = true;

export const PIPELINE_POST_TYPES = [
  'reel',
  'story_sequence',
  'carousel',
  'static_post',
  'sponsor_post',
  'archive_note',
] as const;

export type PipelinePostType = (typeof PIPELINE_POST_TYPES)[number];

export type PipelineRow = {
  auto_ingest_enabled: boolean;
  auto_pause_threshold: number;
  auto_ingest_interval_minutes: number;
  enabled_post_types: PipelinePostType[];
  auto_reel_render_enabled: boolean;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  last_run_summary: Record<string, unknown> | null;
  updated_at: string;
};

export function normalizeEnabledPostTypes(raw: unknown): PipelinePostType[] {
  if (!Array.isArray(raw)) return [...PIPELINE_POST_TYPES];
  const allowed = new Set<string>(PIPELINE_POST_TYPES);
  const out: PipelinePostType[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && allowed.has(v)) {
      out.push(v as PipelinePostType);
    }
  }
  return out;
}

export async function needsReviewCount(
  supabase: ReturnType<typeof getSupabaseServiceRole>,
): Promise<number> {
  const { count, error } = await supabase
    .from('post_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'needs_review');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadPipelineRow(
  supabase: ReturnType<typeof getSupabaseServiceRole>,
): Promise<PipelineRow> {
  const { data, error } = await supabase
    .from('pipeline_settings')
    .select(
      'auto_ingest_enabled,auto_pause_threshold,auto_ingest_interval_minutes,enabled_post_types,auto_reel_render_enabled,last_run_started_at,last_run_finished_at,last_run_status,last_run_summary,updated_at',
    )
    .eq('singleton', PIPELINE_SINGLETON)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error('pipeline_settings row missing; apply migration 20260513120000_pipeline_settings.sql');
  }
  const row = data as PipelineRow;
  return {
    ...row,
    auto_ingest_interval_minutes: row.auto_ingest_interval_minutes ?? 30,
    enabled_post_types: normalizeEnabledPostTypes(row.enabled_post_types),
    auto_reel_render_enabled: row.auto_reel_render_enabled === true,
  };
}

export function toPipelinePayload(row: PipelineRow, needsReview: number) {
  return {
    auto_ingest_enabled: row.auto_ingest_enabled,
    auto_pause_threshold: row.auto_pause_threshold,
    auto_ingest_interval_minutes: row.auto_ingest_interval_minutes,
    enabled_post_types: normalizeEnabledPostTypes(row.enabled_post_types),
    auto_reel_render_enabled: row.auto_reel_render_enabled === true,
    needs_review_count: needsReview,
    last_run_started_at: row.last_run_started_at,
    last_run_finished_at: row.last_run_finished_at,
    last_run_status: row.last_run_status,
    last_run_summary: row.last_run_summary,
    updated_at: row.updated_at,
  };
}

export const PIPELINE_SINGLETON_KEY = PIPELINE_SINGLETON;
