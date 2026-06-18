import type { SupabaseClient } from '@supabase/supabase-js';

import { buildPublishingCaption } from './caption.js';
import { assessPublishingEligibility, resolvePublishType } from './eligibility.js';
import { resolveCandidateMedia } from './resolve-media.js';
import { findProducedReelRender } from './reel-publish.js';
import { isStageableCandidateStatus } from './staging-gates.js';
import type { PostCandidateRow, PublishType } from './types.js';

const PUBLISHING_CANDIDATE_PREP_COLUMNS = [
  'id',
  'post_type',
  'caption_fr',
  'caption_en',
  'hashtags',
  'story_frames',
  'reel_instructions',
  'carousel_slides',
  'static_post_instructions',
  'source_asset_ids',
  'source_drive_file_ids',
  'status',
].join(',');

function igCaption(raw: string): string {
  const max = 2200;
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function insertFailedJob(
  supabase: SupabaseClient,
  candidate: PostCandidateRow,
  publishType: PublishType,
  caption: string,
  reason: string,
): Promise<void> {
  const row = {
    post_candidate_id: candidate.id,
    platform: 'instagram',
    publish_type: publishType,
    status: 'failed',
    caption,
    hashtags: candidate.hashtags ?? [],
    source_asset_ids: [],
    source_drive_file_ids: [],
    prepared_media: [],
    public_media_urls: [],
    instagram_child_container_ids: [],
    instagram_parent_container_id: null,
    instagram_creation_id: null,
    instagram_container_status: null,
    instagram_media_id: null,
    graph_api_review_url: null,
    graph_api_raw: null,
    error_message: reason,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('publishing_jobs').insert(row).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.id) {
    await supabase
      .from('post_candidates')
      .update({ publishing_job_id: data.id, updated_at: new Date().toISOString() })
      .eq('id', candidate.id);
  }
}

async function createDraftJob(
  supabase: SupabaseClient,
  candidate: PostCandidateRow,
  publishType: PublishType,
  caption: string,
  sourceAssetIds: string[],
  sourceDriveIds: string[],
): Promise<string> {
  const row = {
    post_candidate_id: candidate.id,
    platform: 'instagram',
    publish_type: publishType,
    status: 'draft',
    caption,
    hashtags: candidate.hashtags ?? [],
    source_asset_ids: sourceAssetIds,
    source_drive_file_ids: sourceDriveIds,
    prepared_media: [],
    public_media_urls: [],
    instagram_child_container_ids: [],
    instagram_parent_container_id: null,
    instagram_creation_id: null,
    instagram_container_status: null,
    instagram_media_id: null,
    graph_api_review_url: null,
    graph_api_raw: null,
    error_message: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('publishing_jobs').insert(row).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error('Insert publishing_jobs returned no id');
  await supabase
    .from('post_candidates')
    .update({ publishing_job_id: data.id, updated_at: new Date().toISOString() })
    .eq('id', candidate.id);
  return data.id;
}

async function ensureJobForApprovedCandidate(
  supabase: SupabaseClient,
  candidate: PostCandidateRow,
): Promise<string | null> {
  const caption = igCaption(buildPublishingCaption(candidate));
  const resolved = await resolveCandidateMedia(supabase, candidate);
  const reelRender = await findProducedReelRender(supabase, candidate.id);
  const el = assessPublishingEligibility(candidate, resolved, {
    hasProducedReelRender: reelRender != null,
  });

  if (!el.ok) {
    const fallbackType = resolvePublishType(candidate, resolved) ?? 'image';
    await insertFailedJob(supabase, candidate, fallbackType, caption, el.reason);
    return null;
  }

  return createDraftJob(
    supabase,
    candidate,
    el.publishType,
    caption,
    resolved.map((r) => r.asset_id),
    resolved.map((r) => r.drive_file_id),
  );
}

const OPEN_PUBLISHING_JOB_STATUSES = [
  'draft',
  'media_prepared',
  'containers_created',
  'processing',
  'failed',
] as const;

/** Create a draft publishing job after eligibility checks — no media prep or Graph containers. */
export async function validatePublishingForCandidate(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<string | null> {
  const { data: candidateRow, error: cErr } = await supabase
    .from('post_candidates')
    .select(PUBLISHING_CANDIDATE_PREP_COLUMNS)
    .eq('id', candidateId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!candidateRow) throw new Error(`Candidate not found: ${candidateId}`);
  const candidate = candidateRow as unknown as PostCandidateRow;

  const st = String(candidate.status ?? '');
  if (st === 'rejected' || st === 'needs_review' || st === 'needs_rewrite') {
    throw new Error(`Cannot stage publishing: post_candidates.status is "${st}".`);
  }
  if (!isStageableCandidateStatus(st)) {
    throw new Error(`Cannot stage publishing for candidate status "${st}".`);
  }

  const { data: existingJob, error: jErr } = await supabase
    .from('publishing_jobs')
    .select('id, status')
    .eq('post_candidate_id', candidateId)
    .maybeSingle();
  if (jErr) throw new Error(jErr.message);

  if (existingJob) {
    const js = String(existingJob.status ?? '');
    if (js === 'scheduled' || js === 'ready_to_publish' || js === 'published' || js === 'publishing') {
      return existingJob.id as string;
    }
    if (js === 'draft' || (OPEN_PUBLISHING_JOB_STATUSES as readonly string[]).includes(js)) {
      return existingJob.id as string;
    }
    throw new Error(`Cannot stage publishing: existing job status is "${js}".`);
  }

  return ensureJobForApprovedCandidate(supabase, candidate);
}

export { ensureJobForApprovedCandidate };
