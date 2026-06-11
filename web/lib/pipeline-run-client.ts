import { readJsonResponse } from '@/lib/read-json-response';

export type PipelineRunPayload = {
  auto_ingest_enabled: boolean;
  auto_pause_threshold: number;
  auto_ingest_interval_minutes: number;
  enabled_post_types: string[];
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

export async function dispatchPipelineRun(
  stage: 'full' | 'candidates_only',
): Promise<PipelineRunPayload> {
  const res = await fetch('/api/content-review/pipeline/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
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
