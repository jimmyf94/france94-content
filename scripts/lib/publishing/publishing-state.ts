import type { SupabaseClient } from '@supabase/supabase-js';

import { onPublishingJobStatusTransition } from '../asset-usage.js';
import { getInstagramContainerStatus, isFinished } from './instagram-graph.js';
import type { PreparedMediaItem, PublishingJobStatus } from './types.js';

function coerceJsonArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function parsePreparedMedia(raw: unknown): PreparedMediaItem[] {
  const arr = coerceJsonArray(raw);
  if (!arr) return [];
  const out: PreparedMediaItem[] = [];
  for (const x of arr) {
    if (x == null || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const mediaType = o.media_type === 'video' || o.media_type === 'image' ? o.media_type : null;
    const publicUrl = typeof o.public_url === 'string' ? o.public_url : '';
    if (!mediaType || !publicUrl) continue;
    out.push({
      asset_id: typeof o.asset_id === 'string' ? o.asset_id : null,
      drive_file_id: typeof o.drive_file_id === 'string' ? o.drive_file_id : '',
      media_type: mediaType,
      public_url: publicUrl,
      width: typeof o.width === 'number' ? o.width : null,
      height: typeof o.height === 'number' ? o.height : null,
      duration_seconds:
        typeof o.duration_seconds === 'number' ? o.duration_seconds : null,
      mime_type: typeof o.mime_type === 'string' ? o.mime_type : 'application/octet-stream',
      order: typeof o.order === 'number' ? o.order : out.length + 1,
    });
  }
  return out;
}

type JobRow = Record<string, unknown>;

export async function updatePublishingJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  let prevStatus = '';
  if (patch.status !== undefined) {
    const { data: row, error: readErr } = await supabase
      .from('publishing_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    prevStatus = String((row as { status?: string } | null)?.status ?? '');
  }

  const { error } = await supabase
    .from('publishing_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw new Error(error.message);

  if (patch.status !== undefined) {
    const nextStatus = String(patch.status);
    try {
      await onPublishingJobStatusTransition(supabase, jobId, prevStatus, nextStatus);
    } catch (e) {
      console.error('[asset-usage] onPublishingJobStatusTransition', e);
    }
  }
}

export async function syncCandidateReadyToPublish(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('post_candidates')
    .update({
      status: 'ready_to_publish',
      publishing_job_id: jobId,
      ready_to_publish_at: now,
      updated_at: now,
    })
    .eq('id', candidateId);
  if (error) throw new Error(error.message);
}

export async function syncCandidatePosted(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('post_candidates')
    .update({
      status: 'posted',
      publishing_job_id: jobId,
      updated_at: now,
    })
    .eq('id', candidateId);
  if (error) throw new Error(error.message);
}

function statusUpper(raw: unknown): string {
  return String(raw ?? '').toUpperCase();
}

/**
 * Poll Graph container status for children + parent (carousel) or single creation id.
 */
export async function refreshPublishingJobFromGraph(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ status: PublishingJobStatus; summary: string }> {
  const { data: row, error } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error('Publishing job not found');

  const r = row as JobRow;
  const childIds = Array.isArray(r.instagram_child_container_ids)
    ? (r.instagram_child_container_ids as string[])
    : [];
  const parentId =
    typeof r.instagram_parent_container_id === 'string'
      ? r.instagram_parent_container_id
      : null;
  const creationId = typeof r.instagram_creation_id === 'string' ? r.instagram_creation_id : null;

  const toPoll: string[] = [];
  if (childIds.length > 0) {
    toPoll.push(...childIds);
    if (parentId) toPoll.push(parentId);
  } else if (creationId) {
    toPoll.push(creationId);
  } else {
    return {
      status: (r.status as PublishingJobStatus) ?? 'draft',
      summary: 'no_containers',
    };
  }

  const polls: Record<string, Record<string, unknown>> = {};
  const parts: string[] = [];
  let anyError = false;

  for (const id of toPoll) {
    try {
      const p = await getInstagramContainerStatus(id);
      polls[id] = p.raw;
      parts.push(`${id.slice(0, 8)}:${p.status_code ?? '?'}`);
      const code = statusUpper(p.status_code);
      if (code === 'ERROR' || code === 'EXPIRED') {
        anyError = true;
      }
    } catch (e) {
      anyError = true;
      polls[id] = { error: e instanceof Error ? e.message : String(e) };
      parts.push(`${id.slice(0, 8)}:poll_error`);
    }
  }

  const summary = parts.join(' ');
  const graphRaw = {
    polled_at: new Date().toISOString(),
    polls,
    summary,
  };

  const prevStatus = (r.status as PublishingJobStatus) ?? 'draft';
  let nextStatus: PublishingJobStatus = prevStatus;
  let errorMessage: string | null =
    typeof r.error_message === 'string' ? r.error_message : null;

  const preserveGraphDerivedStatus =
    prevStatus === 'scheduled' || prevStatus === 'publishing' || prevStatus === 'published';

  if (preserveGraphDerivedStatus) {
    if (anyError) {
      if (prevStatus === 'published') {
        nextStatus = 'published';
      } else {
        nextStatus = 'failed';
        errorMessage =
          errorMessage ?? 'Graph API container reported ERROR/EXPIRED or poll failed.';
      }
    } else {
      nextStatus = prevStatus;
    }
  } else if (anyError) {
    nextStatus = 'failed';
    errorMessage = errorMessage ?? 'Graph API container reported ERROR/EXPIRED or poll failed.';
  } else if (childIds.length > 0) {
    const childPollsOk = childIds.every((cid) => polls[cid] != null);
    const childrenFinished =
      childPollsOk &&
      childIds.every((cid) => {
        const code = (polls[cid]?.status_code as string | undefined) ?? null;
        return isFinished(code);
      });

    if (!parentId) {
      const pubType = typeof r.publish_type === 'string' ? r.publish_type : '';
      nextStatus = childrenFinished
        ? (pubType === 'story_sequence' ? 'ready_to_publish' : 'containers_created')
        : 'processing';
    } else {
      const parentFinished = isFinished(
        (polls[parentId]?.status_code as string | undefined) ?? null,
      );
      nextStatus =
        childrenFinished && parentFinished ? 'ready_to_publish' : 'processing';
    }
  } else if (creationId) {
    const code = (polls[creationId]?.status_code as string | undefined) ?? null;
    nextStatus = isFinished(code) ? 'ready_to_publish' : 'processing';
  }

  await updatePublishingJob(supabase, jobId, {
    instagram_container_status: summary,
    graph_api_raw: graphRaw,
    status: nextStatus,
    error_message: nextStatus === 'failed' ? errorMessage : null,
  });

  if (nextStatus === 'ready_to_publish' && prevStatus !== 'scheduled' && prevStatus !== 'publishing') {
    const candidateId = r.post_candidate_id as string;
    await syncCandidateReadyToPublish(supabase, candidateId, jobId);
  }

  return { status: nextStatus, summary };
}
