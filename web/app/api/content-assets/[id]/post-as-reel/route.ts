import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AssetUsageError,
  computeLaneCooldownUntil,
  deletePostCandidateCompletely,
  releaseAssetsForCandidate,
  reserveAssetsForCandidate,
} from '@fr94/asset-usage';
import { updatePublishingJob } from '@fr94/publishing/publishing-state';
import { validatePublishingForCandidate } from '@fr94/publishing/validate-publishing-candidate';

import { dispatchGithubWorkflow } from '@/lib/github-dispatch';
import { POST_CANDIDATE_DETAIL_COLUMNS } from '@/lib/post-candidate-api-columns';
import {
  assetDisplayTitle,
  isVideoAsset,
  normalizeHashtags,
} from '@/lib/post-as-reel-utils';
import { assertReviewAuthorized, getCurrentUserEmail } from '@/lib/review-auth';
import { getSupabaseServiceRole } from '@/lib/supabase-server';

export const runtime = 'nodejs';

const postSchema = z
  .object({
    caption_fr: z.string().trim().min(1, 'Caption is required'),
    caption_en: z.string().trim().optional().nullable(),
    hashtags: z.array(z.string()).optional().nullable(),
    trial_reel: z.boolean(),
  })
  .strict();

async function rollbackCandidate(supabase: ReturnType<typeof getSupabaseServiceRole>, candidateId: string) {
  try {
    await releaseAssetsForCandidate(supabase, candidateId);
  } catch (e) {
    console.warn('[post-as-reel] release before delete failed', e);
  }
  try {
    await deletePostCandidateCompletely(supabase, candidateId);
  } catch (e) {
    console.error('[post-as-reel] rollback delete failed', e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = assertReviewAuthorized(req);
  if (denied) return denied;

  const { id: assetId } = await ctx.params;
  if (!assetId?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { caption_fr, caption_en, hashtags, trial_reel } = parsed.data;
  const normalizedTags = normalizeHashtags(hashtags);
  const supabase = getSupabaseServiceRole();
  const now = new Date().toISOString();
  const reviewedBy = await getCurrentUserEmail(req);

  const { data: asset, error: assetErr } = await supabase
    .from('content_assets')
    .select(
      'id,drive_file_id,mime_type,media_type,final_filename,current_filename,original_filename,status',
    )
    .eq('id', assetId)
    .maybeSingle();

  if (assetErr) {
    console.error('[post-as-reel] asset read', assetErr);
    return NextResponse.json({ error: assetErr.message }, { status: 500 });
  }
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  if (!isVideoAsset(asset)) {
    return NextResponse.json({ error: 'Only video assets can be posted as reels.' }, { status: 400 });
  }

  const driveFileId = typeof asset.drive_file_id === 'string' ? asset.drive_file_id.trim() : '';
  if (!driveFileId) {
    return NextResponse.json({ error: 'Asset has no Drive file id.' }, { status: 400 });
  }

  const candidateId = randomUUID();
  const title = assetDisplayTitle(asset);
  const candidateDate = now.slice(0, 10);

  const { error: insertErr } = await supabase.from('post_candidates').insert({
    id: candidateId,
    candidate_date: candidateDate,
    platform: 'instagram',
    post_type: 'reel',
    title,
    hook: null,
    concept_summary: 'Posted from asset library',
    rationale: null,
    caption_fr,
    caption_en: caption_en?.trim() ? caption_en.trim() : null,
    hashtags: normalizedTags,
    story_frames: [],
    reel_instructions: {},
    carousel_slides: [],
    static_post_instructions: {},
    source_asset_ids: [assetId],
    source_drive_file_ids: [driveFileId],
    priority_score: 5,
    mission_score: 5,
    human_score: 5,
    sponsor_safety_score: 5,
    effort_score: 2,
    status: 'needs_review',
    llm_model: 'library-post-as-reel',
    llm_raw: { origin: 'library-post-as-reel', content_asset_id: assetId },
    updated_at: now,
  });

  if (insertErr) {
    console.error('[post-as-reel] insert candidate', insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  try {
    await reserveAssetsForCandidate(supabase, candidateId);
  } catch (e) {
    await rollbackCandidate(supabase, candidateId);
    const msg = e instanceof AssetUsageError ? e.message : e instanceof Error ? e.message : String(e);
    const code = e instanceof AssetUsageError ? e.code : 'asset_usage';
    const statusCode = e instanceof AssetUsageError && e.code === 'no_assets' ? 400 : 409;
    return NextResponse.json({ error: msg, code }, { status: statusCode });
  }

  const { error: approveErr } = await supabase
    .from('post_candidates')
    .update({
      status: 'approved',
      reviewed_at: now,
      reviewed_by: reviewedBy,
      cooldown_until: computeLaneCooldownUntil('reel', new Date(now)),
      updated_at: now,
    })
    .eq('id', candidateId);

  if (approveErr) {
    console.error('[post-as-reel] approve candidate', approveErr);
    await rollbackCandidate(supabase, candidateId);
    return NextResponse.json({ error: approveErr.message }, { status: 500 });
  }

  let jobId: string | null;
  try {
    jobId = await validatePublishingForCandidate(supabase, candidateId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[post-as-reel] validate publishing', msg);
    await rollbackCandidate(supabase, candidateId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!jobId) {
    await rollbackCandidate(supabase, candidateId);
    return NextResponse.json(
      { error: 'This asset is not eligible for reel publishing prep.' },
      { status: 409 },
    );
  }

  try {
    await updatePublishingJob(supabase, jobId, {
      reel_trial_graduation_strategy: trial_reel ? 'SS_PERFORMANCE' : null,
    });
    await updatePublishingJob(supabase, jobId, {
      status: 'scheduled',
      scheduled_publish_at: now,
      error_message: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[post-as-reel] schedule job', msg);
    await rollbackCandidate(supabase, candidateId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const dispatch = await dispatchGithubWorkflow('publish-scheduled.yml');

  const { data: candidate, error: cOutErr } = await supabase
    .from('post_candidates')
    .select(POST_CANDIDATE_DETAIL_COLUMNS)
    .eq('id', candidateId)
    .maybeSingle();
  if (cOutErr) {
    console.error('[post-as-reel] read candidate', cOutErr);
  }

  const { data: job, error: jOutErr } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jOutErr) {
    console.error('[post-as-reel] read job', jOutErr);
  }

  return NextResponse.json({
    ok: true,
    candidate_id: candidateId,
    publishing_job_id: jobId,
    candidate: candidate ?? null,
    job: job ?? null,
    dispatched: dispatch.ok,
    message: dispatch.ok
      ? 'Reel publish pipeline started. Instagram may take a few minutes.'
      : 'Reel scheduled for publish. Worker will pick it up within ~5 minutes.',
  });
}
