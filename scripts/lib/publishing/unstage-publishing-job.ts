import type { SupabaseClient } from '@supabase/supabase-js';

import {
  refreshCandidateAssetConflicts,
  refreshConflictsForAssets,
  releasePublishingJobUsage,
} from '../asset-usage.js';

const BLOCKED_UNSTAGE_STATUSES = new Set(['scheduled', 'publishing', 'published']);

export class UnstagePublishingJobError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'blocked_status' | 'candidate_missing',
  ) {
    super(message);
    this.name = 'UnstagePublishingJobError';
  }
}

export function resolveCandidateStatusAfterUnstage(
  productionJobStatus: string | null | undefined,
): 'produced' | 'approved' {
  return productionJobStatus === 'produced' ? 'produced' : 'approved';
}

export function validateUnstagePublishingJobStatus(status: string): void {
  const st = (status ?? '').trim();
  if (BLOCKED_UNSTAGE_STATUSES.has(st)) {
    if (st === 'scheduled') {
      throw new UnstagePublishingJobError(
        'Cancel schedule before unstaging this post.',
        'blocked_status',
      );
    }
    throw new UnstagePublishingJobError(
      `Cannot unstage publishing job with status "${st}".`,
      'blocked_status',
    );
  }
}

export type UnstagePublishingJobResult = {
  candidate_id: string;
  reverted_status: 'produced' | 'approved';
};

/**
 * Fully unstage a publishing job: release job-scoped asset locks, delete the job,
 * revert the candidate to produced/approved. Instagram Graph containers are not
 * deleted (they expire naturally; re-staging creates fresh containers).
 */
export async function unstagePublishingJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<UnstagePublishingJobResult> {
  const { data: job, error: jobErr } = await supabase
    .from('publishing_jobs')
    .select('id, post_candidate_id, status')
    .eq('id', jobId)
    .maybeSingle();

  if (jobErr) throw new Error(jobErr.message);
  if (!job) {
    throw new UnstagePublishingJobError('Publishing job not found.', 'not_found');
  }

  const candidateId = String((job as { post_candidate_id?: string }).post_candidate_id ?? '');
  const jobStatus = String((job as { status?: string }).status ?? '');
  validateUnstagePublishingJobStatus(jobStatus);

  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select('id')
    .eq('id', candidateId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!candidate) {
    throw new UnstagePublishingJobError('Post candidate not found.', 'candidate_missing');
  }

  const { data: prodRows, error: prodErr } = await supabase
    .from('production_jobs')
    .select('status')
    .eq('post_candidate_id', candidateId)
    .eq('production_type', 'reel')
    .limit(1);
  if (prodErr) throw new Error(prodErr.message);

  const productionStatus =
    ((prodRows?.[0] as { status?: string } | undefined)?.status ?? '').trim() || null;
  const revertedStatus = resolveCandidateStatusAfterUnstage(productionStatus);

  const assetIds = await releasePublishingJobUsage(supabase, jobId);

  const { error: delErr } = await supabase.from('publishing_jobs').delete().eq('id', jobId);
  if (delErr) throw new Error(delErr.message);

  const now = new Date().toISOString();
  const { error: candErr } = await supabase
    .from('post_candidates')
    .update({
      status: revertedStatus,
      publishing_job_id: null,
      ready_to_publish_at: null,
      updated_at: now,
    })
    .eq('id', candidateId);
  if (candErr) throw new Error(candErr.message);

  await refreshCandidateAssetConflicts(supabase, candidateId);
  if (assetIds.length > 0) {
    await refreshConflictsForAssets(supabase, assetIds);
  }

  return { candidate_id: candidateId, reverted_status: revertedStatus };
}
