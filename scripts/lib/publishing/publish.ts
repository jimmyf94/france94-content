import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getMediaPermalink,
  mediaPublish,
  requireInstagramEnv,
} from './instagram-graph.js';
import { updatePublishingJob } from './publishing-state.js';

type JobRow = Record<string, unknown>;

function mergeGraphRaw(
  prev: unknown,
  publishBlock: Record<string, unknown>,
  publishedAt: string,
): Record<string, unknown> {
  const base =
    prev != null && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {};
  return {
    ...base,
    last_publish: publishBlock,
    last_published_at: publishedAt,
  };
}

/**
 * Final Instagram publish via `media_publish`.
 * Allowed job statuses: `ready_to_publish` or `scheduled`.
 * Story sequence: one `media_publish` per child creation id (stores first media id on row).
 */
export async function publishPublishingJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ mediaId: string | null; permalink: string | null }> {
  const { data: row, error } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error('Publishing job not found');

  const r = row as JobRow;
  const status = String(r.status ?? '');
  if (status !== 'ready_to_publish' && status !== 'scheduled') {
    throw new Error(`Job is not publishable (status=${status}).`);
  }

  const { igUserId } = requireInstagramEnv();
  const publishType = String(r.publish_type ?? '');
  const childIds = Array.isArray(r.instagram_child_container_ids)
    ? (r.instagram_child_container_ids as string[]).filter((x) => typeof x === 'string' && x.trim())
    : [];
  const creationId =
    typeof r.instagram_creation_id === 'string' && r.instagram_creation_id.trim()
      ? r.instagram_creation_id.trim()
      : null;

  let publishTargets: string[] = [];
  if (publishType === 'story_sequence' && childIds.length > 0) {
    publishTargets = childIds;
  } else if (creationId) {
    publishTargets = [creationId];
  } else {
    throw new Error('Missing Instagram parent/single container id for media_publish.');
  }

  const now = new Date().toISOString();
  const prevCountRaw = r.publish_attempt_count;
  const prevCount =
    typeof prevCountRaw === 'number' && Number.isFinite(prevCountRaw) ? prevCountRaw : 0;

  await updatePublishingJob(supabase, jobId, {
    status: 'publishing',
    publish_attempt_count: prevCount + 1,
    last_publish_attempt_at: now,
    error_message: null,
  });

  try {
    const graphResponses: Record<string, unknown> = {};
    let firstMediaId: string | null = null;
    for (const cid of publishTargets) {
      const mid = await mediaPublish(igUserId, cid);
      graphResponses[cid] = { id: mid };
      if (!firstMediaId) firstMediaId = mid;
    }

    let permalink: string | null = null;
    if (firstMediaId) {
      try {
        permalink = await getMediaPermalink(firstMediaId);
      } catch (e) {
        console.warn('[publishPublishingJob] permalink fetch failed', e);
      }
    }

    const publishedAt = new Date().toISOString();
    const graphRaw = mergeGraphRaw(r.graph_api_raw, { media_publish: graphResponses }, publishedAt);

    await updatePublishingJob(supabase, jobId, {
      status: 'published',
      published_at: publishedAt,
      instagram_media_id: firstMediaId,
      instagram_permalink: permalink,
      graph_api_raw: graphRaw,
    });

    return { mediaId: firstMediaId, permalink };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updatePublishingJob(supabase, jobId, {
      status: 'failed',
      error_message: msg,
    });
    throw e;
  }
}
