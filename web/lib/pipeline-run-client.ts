import { readJsonResponse } from '@/lib/read-json-response';

export type PipelineRunPayload = {
  auto_ingest_enabled: boolean;
  auto_pause_threshold: number;
  auto_ingest_interval_minutes: number;
  enabled_post_types: string[];
  auto_reel_render_enabled: boolean;
  needs_review_count: number;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  last_run_summary: Record<string, unknown> | null;
  updated_at: string;
};

export function isPipelineRunBusy(status: string | null | undefined): boolean {
  return status === 'running' || status === 'dispatching';
}

export type PipelineRunOptions = {
  seriesSlug?: string;
};

export type PipelineRunStage = 'full' | 'candidates_only' | 'assets_only';

export async function dispatchPipelineRun(
  stage: PipelineRunStage,
  options?: PipelineRunOptions,
): Promise<PipelineRunPayload> {
  const body: { stage: typeof stage; series_slug?: string } = { stage };
  const seriesSlug = options?.seriesSlug?.trim();
  if (seriesSlug) body.series_slug = seriesSlug;

  const res = await fetch('/api/content-review/pipeline/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJsonResponse<PipelineRunPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

export async function fetchPipelineStatus(): Promise<PipelineRunPayload> {
  const res = await fetch('/api/content-review/pipeline', { credentials: 'include' });
  const json = await readJsonResponse<PipelineRunPayload & { error?: string }>(res);
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
