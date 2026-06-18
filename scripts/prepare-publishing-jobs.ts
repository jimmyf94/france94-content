import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

for (const envPath of [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')]) {
  dotenv.config({ path: envPath });
}
import type { drive_v3 } from 'googleapis';

import { getDriveClient } from './ingest-drive-content.js';
import { fetchDriveFileMedia, maxPublishingFileBytes } from './lib/drive-media-download.js';
import { formatGoogleDriveApiError } from './lib/google-drive-auth.js';
import {
  assessPublishingEligibility,
  buildPublishingCaption,
  resolvePublishType,
  createCarouselImageChild,
  createCarouselParentContainer,
  createCarouselVideoChild,
  createFeedImageContainer,
  createFeedVideoContainer,
  createReelsContainer,
  createStoryImageContainer,
  createStoryVideoContainer,
  graphApiVersion,
  normalizeImageForInstagram,
  normalizeVideoForInstagram,
  parsePreparedMedia,
  pollContainerUntilTerminal,
  refreshPublishingJobFromGraph,
  requireInstagramEnv,
  resolveCandidateMedia,
  updatePublishingJob,
  uploadPublicMedia,
} from './lib/publishing/index.js';
import { findProducedReelRender, parseReelTrialGraduationStrategy, type ReelTrialGraduationStrategy } from './lib/publishing/reel-publish.js';
import { isStageableCandidateStatus } from './lib/publishing/staging-gates.js';
import type { PostCandidateRow, PreparedMediaItem, PublishType } from './lib/publishing/types.js';
import {
  ensureJobForApprovedCandidate,
  validatePublishingForCandidate,
} from './lib/publishing/validate-publishing-candidate.js';

export { validatePublishingForCandidate };

const PUBLISHING_JOB_PREP_COLUMNS = [
  'id',
  'post_candidate_id',
  'status',
  'publish_type',
  'prepared_media',
  'public_media_urls',
  'instagram_child_container_ids',
  'instagram_parent_container_id',
  'instagram_creation_id',
  'instagram_container_status',
  'instagram_media_id',
  'instagram_permalink',
  'error_message',
  'scheduled_publish_at',
  'published_at',
  'publish_attempt_count',
  'last_publish_attempt_at',
  'reel_trial_graduation_strategy',
  'updated_at',
].join(',');

export const PUBLISHING_CANDIDATE_PREP_COLUMNS = [
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function forceRebuild(): boolean {
  const v = process.env.FORCE_REBUILD_PUBLISHING_JOB?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Default on; set FR94_PUBLISHING_LOG=0|false|no for quiet runs (e.g. CI). */
function publishingLogEnabled(): boolean {
  const v = process.env.FR94_PUBLISHING_LOG?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

function pubLog(msg: string, extra?: Record<string, unknown>): void {
  if (!publishingLogEnabled()) return;
  if (extra && Object.keys(extra).length > 0) {
    console.log(`[prepare:publishing]\t${msg}`, extra);
  } else {
    console.log(`[prepare:publishing]\t${msg}`);
  }
}

type PublishPrepGate = 'proceed' | 'done' | 'blocked';

function candidatePublishPrepGate(candidateStatus: string, jobStatus: string): PublishPrepGate {
  if (candidateStatus === 'ready_to_publish' && jobStatus === 'ready_to_publish') {
    return 'done';
  }
  if (
    candidateStatus === 'rejected' ||
    candidateStatus === 'needs_review' ||
    candidateStatus === 'needs_rewrite'
  ) {
    return 'blocked';
  }
  if (isStageableCandidateStatus(candidateStatus)) return 'proceed';
  if (candidateStatus === 'ready_to_publish' && jobStatus !== 'ready_to_publish') {
    return 'proceed';
  }
  return 'blocked';
}

function igCaption(raw: string): string {
  const max = 2200;
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function prepareMediaForJob(params: {
  supabase: SupabaseClient;
  drive: drive_v3.Drive;
  jobId: string;
  candidateId: string;
  resolved: Awaited<ReturnType<typeof resolveCandidateMedia>>;
}): Promise<PreparedMediaItem[]> {
  const { supabase, drive, jobId, candidateId, resolved } = params;
  pubLog('media prep start', { jobId, candidateId, assetCount: resolved.length });
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const bucket = requireEnv('PUBLIC_MEDIA_BUCKET_NAME');
  const publicBase = requireEnv('PUBLIC_MEDIA_BASE_URL');
  const maxBytes = maxPublishingFileBytes();

  // Reels with a produced render publish the rendered MP4, not raw Drive sources.
  const reelRender = await findProducedReelRender(supabase, candidateId);
  if (reelRender) {
    pubLog('using rendered reel output', { jobId, candidateId, url: reelRender.url });
    const prepared: PreparedMediaItem[] = [
      {
        asset_id: resolved[0]?.asset_id ?? candidateId,
        drive_file_id: resolved[0]?.drive_file_id ?? '',
        media_type: 'video',
        public_url: reelRender.url,
        width: 1080,
        height: 1920,
        duration_seconds: reelRender.durationSeconds,
        mime_type: 'video/mp4',
        order: 1,
      },
    ];
    await updatePublishingJob(supabase, jobId, {
      prepared_media: prepared,
      public_media_urls: [reelRender.url],
      status: 'media_prepared',
    });
    pubLog('media prep done (rendered reel)', { jobId, urlCount: 1, status: 'media_prepared' });
    return prepared;
  }

  const prepared: PreparedMediaItem[] = [];
  const urls: string[] = [];

  let n = 0;
  for (const item of resolved) {
    n += 1;
    const pad = String(n).padStart(2, '0');
    let meta: drive_v3.Schema$File;
    try {
      const m = await drive.files.get({
        fileId: item.drive_file_id,
        fields: 'id,mimeType,name',
        supportsAllDrives: true,
      });
      meta = m.data;
    } catch (e) {
      throw new Error(`Drive metadata ${item.drive_file_id}: ${formatGoogleDriveApiError(e)}`);
    }

    const mimeType = meta.mimeType ?? item.mime_type;
    pubLog('drive download', {
      jobId,
      order: item.order,
      media_type: item.media_type,
      drive_file_id: `${item.drive_file_id.slice(0, 8)}…`,
      name: meta.name ?? '',
    });
    const buf = await fetchDriveFileMedia(drive, item.drive_file_id, maxBytes);
    pubLog('drive bytes', { jobId, order: item.order, bytes: buf.length });

    if (item.media_type === 'image') {
      const norm = await normalizeImageForInstagram({ buffer: buf, mimeType });
      const objectPath = `instagram/${candidateId}/media_${pad}.jpg`;
      const up = await uploadPublicMedia({
        supabase,
        bucket,
        publicBaseUrl: publicBase,
        objectPath,
        body: norm.buffer,
        contentType: norm.mimeType,
      });
      pubLog('uploaded image', {
        jobId,
        order: item.order,
        objectPath,
        public_url: up.publicUrl,
        w: norm.width,
        h: norm.height,
      });
      urls.push(up.publicUrl);
      prepared.push({
        asset_id: item.asset_id,
        drive_file_id: item.drive_file_id,
        media_type: 'image',
        public_url: up.publicUrl,
        width: norm.width,
        height: norm.height,
        duration_seconds: null,
        mime_type: norm.mimeType,
        order: item.order,
      });
    } else if (item.media_type === 'video') {
      const norm = await normalizeVideoForInstagram(buf);
      const objectPath = `instagram/${candidateId}/media_${pad}.mp4`;
      const up = await uploadPublicMedia({
        supabase,
        bucket,
        publicBaseUrl: publicBase,
        objectPath,
        body: norm.buffer,
        contentType: norm.mimeType,
      });
      pubLog('uploaded video', {
        jobId,
        order: item.order,
        objectPath,
        public_url: up.publicUrl,
        w: norm.width,
        h: norm.height,
        duration_s: norm.duration_seconds,
      });
      urls.push(up.publicUrl);
      prepared.push({
        asset_id: item.asset_id,
        drive_file_id: item.drive_file_id,
        media_type: 'video',
        public_url: up.publicUrl,
        width: norm.width,
        height: norm.height,
        duration_seconds: norm.duration_seconds,
        mime_type: norm.mimeType,
        order: item.order,
      });
    } else {
      throw new Error(`Unsupported media_type ${item.media_type} for asset ${item.asset_id}`);
    }
  }

  await updatePublishingJob(supabase, jobId, {
    prepared_media: prepared,
    public_media_urls: urls,
    status: 'media_prepared',
  });
  pubLog('media prep done', { jobId, urlCount: urls.length, status: 'media_prepared' });

  return prepared;
}

async function createGraphContainers(params: {
  supabase: SupabaseClient;
  jobId: string;
  publishType: PublishType;
  caption: string;
  prepared: PreparedMediaItem[];
  reelTrialGraduationStrategy?: ReelTrialGraduationStrategy | null;
}): Promise<void> {
  const { igUserId } = requireInstagramEnv();
  const { jobId, publishType, caption, prepared, reelTrialGraduationStrategy } = params;
  const cap = igCaption(caption);
  pubLog('graph API start', {
    jobId,
    publishType,
    graphVersion: graphApiVersion(),
    ig_user_id: igUserId,
  });

  if (publishType === 'carousel') {
    const childIds: string[] = [];
    for (const m of prepared.sort((a, b) => a.order - b.order)) {
      if (m.media_type === 'image') {
        const id = await createCarouselImageChild({ igUserId, imageUrl: m.public_url });
        childIds.push(id);
        pubLog('carousel child container (image)', { jobId, creation_id: id, order: m.order });
      } else {
        const id = await createCarouselVideoChild({ igUserId, videoUrl: m.public_url });
        childIds.push(id);
        pubLog('carousel child container (video)', { jobId, creation_id: id, order: m.order });
      }
    }
    for (const cid of childIds) {
      const p = await pollContainerUntilTerminal(cid);
      const code = (p.status_code ?? '').toUpperCase();
      pubLog('carousel child polled', { jobId, creation_id: cid, status_code: code });
      if (code === 'ERROR' || code === 'EXPIRED') {
        throw new Error(`Carousel child ${cid} failed: ${JSON.stringify(p.raw)}`);
      }
    }
    const parentId = await createCarouselParentContainer({
      igUserId,
      childCreationIds: childIds,
      caption: cap,
    });
    pubLog('carousel parent container', { jobId, creation_id: parentId });
    const pp = await pollContainerUntilTerminal(parentId);
    const pcode = (pp.status_code ?? '').toUpperCase();
    pubLog('carousel parent polled', { jobId, creation_id: parentId, status_code: pcode });
    if (pcode === 'ERROR' || pcode === 'EXPIRED') {
      throw new Error(`Carousel parent failed: ${JSON.stringify(pp.raw)}`);
    }

    await updatePublishingJob(params.supabase, jobId, {
      instagram_child_container_ids: childIds,
      instagram_parent_container_id: parentId,
      instagram_creation_id: parentId,
      status: 'processing',
    });
    pubLog('graph row updated (carousel)', { jobId, childCount: childIds.length, parentId });
    return;
  }

  if (publishType === 'story_sequence') {
    const childIds: string[] = [];
    for (const m of prepared.sort((a, b) => a.order - b.order)) {
      if (m.media_type === 'image') {
        const id = await createStoryImageContainer({ igUserId, imageUrl: m.public_url });
        childIds.push(id);
        pubLog('story_sequence child container (image)', { jobId, creation_id: id, order: m.order });
      } else {
        const id = await createStoryVideoContainer({ igUserId, videoUrl: m.public_url });
        childIds.push(id);
        pubLog('story_sequence child container (video)', { jobId, creation_id: id, order: m.order });
      }
    }
    for (const cid of childIds) {
      const p = await pollContainerUntilTerminal(cid);
      const code = (p.status_code ?? '').toUpperCase();
      pubLog('story_sequence child polled', { jobId, creation_id: cid, status_code: code });
      if (code === 'ERROR' || code === 'EXPIRED') {
        throw new Error(`Story frame ${cid} failed: ${JSON.stringify(p.raw)}`);
      }
    }

    await updatePublishingJob(params.supabase, jobId, {
      instagram_child_container_ids: childIds,
      instagram_parent_container_id: null,
      instagram_creation_id: childIds[0] ?? null,
      status: 'processing',
    });
    pubLog('graph row updated (story_sequence)', { jobId, childCount: childIds.length });
    return;
  }

  const single = prepared[0];
  if (!single) throw new Error('No prepared media for single-item publish');

  let creationId: string;
  if (publishType === 'image') {
    creationId = await createFeedImageContainer({
      igUserId,
      imageUrl: single.public_url,
      caption: cap,
    });
  } else if (publishType === 'video') {
    creationId = await createFeedVideoContainer({
      igUserId,
      videoUrl: single.public_url,
      caption: cap,
    });
  } else if (publishType === 'reel') {
    creationId = await createReelsContainer({
      igUserId,
      videoUrl: single.public_url,
      caption: cap,
      trialGraduationStrategy: reelTrialGraduationStrategy,
    });
  } else if (publishType === 'story') {
    if (single.media_type === 'image') {
      creationId = await createStoryImageContainer({
        igUserId,
        imageUrl: single.public_url,
      });
    } else {
      creationId = await createStoryVideoContainer({
        igUserId,
        videoUrl: single.public_url,
      });
    }
  } else {
    throw new Error(`Unhandled publish type ${publishType}`);
  }

  pubLog('single media container created', { jobId, publishType, creation_id: creationId });

  const polled = await pollContainerUntilTerminal(creationId);
  const ccode = (polled.status_code ?? '').toUpperCase();
  pubLog('single container polled', { jobId, creation_id: creationId, status_code: ccode });
  if (ccode === 'ERROR' || ccode === 'EXPIRED') {
    throw new Error(`Media container failed: ${JSON.stringify(polled.raw)}`);
  }

  await updatePublishingJob(params.supabase, jobId, {
    instagram_child_container_ids: [],
    instagram_parent_container_id: null,
    instagram_creation_id: creationId,
    status: 'processing',
  });
  pubLog('graph row updated (single)', { jobId, creation_id: creationId });
}

export async function processPublishingJob(supabase: SupabaseClient, jobId: string): Promise<void> {
  const force = forceRebuild();
  if (force) {
    pubLog('FORCE_REBUILD_PUBLISHING_JOB: resetting job media + IG fields', { jobId });
    await updatePublishingJob(supabase, jobId, {
      prepared_media: [],
      public_media_urls: [],
      instagram_child_container_ids: [],
      instagram_parent_container_id: null,
      instagram_creation_id: null,
      instagram_container_status: null,
      graph_api_raw: null,
      instagram_media_id: null,
      instagram_permalink: null,
      scheduled_publish_at: null,
      published_at: null,
      publish_attempt_count: 0,
      last_publish_attempt_at: null,
      error_message: null,
      status: 'draft',
    });
  }

  let { data: job, error: jobErr } = await supabase
    .from('publishing_jobs')
    .select(PUBLISHING_JOB_PREP_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr) throw new Error(jobErr.message);
  if (!job) throw new Error('Job not found');

  if (job.status === 'failed' && !force) {
    const prevPrepared = parsePreparedMedia(job.prepared_media);
    const noIg =
      job.instagram_creation_id == null &&
      (!Array.isArray(job.instagram_child_container_ids) ||
        job.instagram_child_container_ids.length === 0);
    if (prevPrepared.length > 0 && noIg) {
      pubLog('failed job reset to media_prepared for IG retry', { jobId });
      await updatePublishingJob(supabase, jobId, {
        status: 'media_prepared',
        error_message: null,
      });
      const { data: jobAgain } = await supabase
        .from('publishing_jobs')
        .select(PUBLISHING_JOB_PREP_COLUMNS)
        .eq('id', jobId)
        .maybeSingle();
      if (jobAgain) job = jobAgain;
    } else {
      pubLog('skip failed job (no prepared media or IG already set)', {
        jobId,
        preparedCount: prevPrepared.length,
        has_creation: Boolean(job.instagram_creation_id),
      });
      return;
    }
  }

  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select(PUBLISHING_CANDIDATE_PREP_COLUMNS)
    .eq('id', job.post_candidate_id)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!candidate) throw new Error('Candidate not found');

  const cand = candidate as PostCandidateRow;
  const jobStatus = String(job.status ?? '');
  const gate = candidatePublishPrepGate(cand.status, jobStatus);

  pubLog('process job', {
    jobId,
    jobStatus,
    candidateId: cand.id,
    candidateStatus: cand.status,
    post_type: cand.post_type,
    publish_type_on_row: job.publish_type,
    gate,
  });

  if (gate === 'done') {
    pubLog('nothing to do (candidate and job both ready_to_publish)', { jobId, candidateId: cand.id });
    return;
  }

  if (gate === 'blocked') {
    const dead =
      cand.status === 'rejected' ||
      cand.status === 'needs_review' ||
      cand.status === 'needs_rewrite';
    const msg = dead
      ? `Publishing prep stopped: post_candidates.status is "${cand.status}".`
      : `Publishing prep skipped: post_candidates.status is "${cand.status}". Re-approve the candidate to continue, or delete this publishing job.`;
    pubLog('candidate gate blocked', { jobId, candidateId: cand.id, reason: msg });
    console.warn(`[prepare:publishing]\t${msg}`);
    await updatePublishingJob(supabase, jobId, {
      status: 'failed',
      error_message: msg,
    });
    return;
  }

  const caption = igCaption(buildPublishingCaption(cand));
  const resolved = await resolveCandidateMedia(supabase, cand);
  pubLog('resolved media', {
    jobId,
    count: resolved.length,
    first_drive: resolved[0]?.drive_file_id?.slice(0, 12) ?? null,
  });
  const reelRender = await findProducedReelRender(supabase, cand.id);
  const el = assessPublishingEligibility(cand, resolved, {
    hasProducedReelRender: reelRender != null,
  });
  if (!el.ok) {
    pubLog('eligibility failed', { jobId, reason: el.reason });
  } else {
    pubLog('eligibility ok', { jobId, publishType: el.publishType });
  }

  if (!el.ok) {
    await updatePublishingJob(supabase, jobId, {
      status: 'failed',
      error_message: el.reason,
      caption,
      hashtags: cand.hashtags ?? [],
      updated_at: new Date().toISOString(),
    });
    return;
  }

  await updatePublishingJob(supabase, jobId, {
    publish_type: el.publishType,
    caption,
    hashtags: cand.hashtags ?? [],
    source_asset_ids: resolved.map((r) => r.asset_id),
    source_drive_file_ids: resolved.map((r) => r.drive_file_id),
    error_message: null,
  });

  const { data: jobFresh } = await supabase
    .from('publishing_jobs')
    .select(PUBLISHING_JOB_PREP_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (jobFresh) job = jobFresh;

  let prepared = parsePreparedMedia(job.prepared_media);
  const hasMedia = prepared.length > 0 && !force;
  pubLog('media checkpoint', { jobId, hasMedia, preparedCount: prepared.length, force });

  const drive = await getDriveClient();

  if (!hasMedia) {
    try {
      prepared = await prepareMediaForJob({
        supabase,
        drive,
        jobId,
        candidateId: cand.id,
        resolved,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pubLog('media prep error', { jobId, error: msg });
      if (e instanceof Error && e.stack) console.error(e.stack);
      await updatePublishingJob(supabase, jobId, {
        status: 'failed',
        error_message: msg,
      });
      return;
    }
  } else {
    prepared = parsePreparedMedia(job.prepared_media);
    pubLog('skip download (prepared_media already present)', { jobId, count: prepared.length });
  }

  let igReady = false;
  try {
    requireInstagramEnv();
    igReady = true;
  } catch {
    igReady = false;
  }
  pubLog('instagram env', { jobId, ig_configured: igReady });

  if (!igReady) {
    pubLog('instagram env missing after media prep', { jobId });
    await updatePublishingJob(supabase, jobId, {
      status: 'failed',
      error_message:
        'Missing INSTAGRAM_GRAPH_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID (media prepared; configure env and re-run).',
    });
    return;
  }

  const { data: jobIg } = await supabase
    .from('publishing_jobs')
    .select(PUBLISHING_JOB_PREP_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();
  if (jobIg) job = jobIg;

  const existingCreation =
    typeof job.instagram_creation_id === 'string' && job.instagram_creation_id.length > 0;
  if (existingCreation && !force) {
    pubLog('refresh only (creation id already set)', {
      jobId,
      instagram_creation_id: job.instagram_creation_id,
    });
    await refreshPublishingJobFromGraph(supabase, jobId);
    pubLog('refreshPublishingJobFromGraph done', { jobId });
    return;
  }

  try {
    const trialStrategy = parseReelTrialGraduationStrategy(
      (job as Record<string, unknown>).reel_trial_graduation_strategy,
    );
    await createGraphContainers({
      supabase,
      jobId,
      publishType: el.publishType,
      caption,
      prepared,
      reelTrialGraduationStrategy: trialStrategy,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pubLog('graph API error', { jobId, error: msg });
    if (e instanceof Error && e.stack) console.error(e.stack);
    await updatePublishingJob(supabase, jobId, {
      status: 'failed',
      error_message: msg,
    });
    return;
  }

  await refreshPublishingJobFromGraph(supabase, jobId);
  pubLog('process job finished refresh', { jobId });
}

const OPEN_PUBLISHING_JOB_STATUSES = [
  'draft',
  'media_prepared',
  'containers_created',
  'processing',
  'failed',
] as const;

function parseCandidateIdArg(): string | undefined {
  const fromEquals = process.argv.find((a) => a.startsWith('--candidate-id='));
  if (fromEquals) {
    const v = fromEquals.slice('--candidate-id='.length).trim();
    if (v) return v;
  }
  const idx = process.argv.indexOf('--candidate-id');
  if (idx >= 0) {
    const v = process.argv[idx + 1]?.trim();
    if (v && !v.startsWith('-')) return v;
  }
  return undefined;
}

function parseValidateOnlyArg(): boolean {
  return (
    process.argv.includes('--validate-only') ||
    process.argv.some((a) => a.startsWith('--validate-only'))
  );
}

/** Prepare (or resume) publishing for one candidate — used by CLI `--candidate-id` and review UI. */
export async function preparePublishingForCandidate(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<void> {
  const { data: candidate, error: cErr } = await supabase
    .from('post_candidates')
    .select(PUBLISHING_CANDIDATE_PREP_COLUMNS)
    .eq('id', candidateId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);

  const st = String(candidate.status ?? '');
  if (st === 'rejected' || st === 'needs_review' || st === 'needs_rewrite') {
    throw new Error(`Cannot prepare publishing: post_candidates.status is "${st}".`);
  }

  const { data: existingJob, error: jErr } = await supabase
    .from('publishing_jobs')
    .select('id, status')
    .eq('post_candidate_id', candidateId)
    .maybeSingle();
  if (jErr) throw new Error(jErr.message);

  if (existingJob) {
    const js = String(existingJob.status ?? '');
    if (st === 'ready_to_publish' && js === 'ready_to_publish') {
      pubLog('nothing to do (candidate and job both ready_to_publish)', { candidateId });
      return;
    }
    if (
      (OPEN_PUBLISHING_JOB_STATUSES as readonly string[]).includes(js) &&
      (isStageableCandidateStatus(st) || (st === 'ready_to_publish' && js !== 'ready_to_publish'))
    ) {
      pubLog('resume single candidate', {
        candidateId,
        jobId: existingJob.id,
        jobStatus: js,
        candidateStatus: st,
      });
      await processPublishingJob(supabase, existingJob.id as string);
      return;
    }
    if (isStageableCandidateStatus(st)) {
      throw new Error(
        `Cannot prepare publishing: existing job status is "${js}". Delete the job or use publishing detail to continue.`,
      );
    }
  }

  if (isStageableCandidateStatus(st)) {
    pubLog('fresh single candidate', { candidateId, post_type: candidate.post_type });
    const jobId = await ensureJobForApprovedCandidate(supabase, candidate as PostCandidateRow);
    if (jobId) {
      await processPublishingJob(supabase, jobId);
    }
    return;
  }

  throw new Error(`Cannot prepare publishing for candidate status "${st}".`);
}

export async function getApprovedCandidatesWithoutPublishingJobs(
  supabase: SupabaseClient,
): Promise<PostCandidateRow[]> {
  const { data: jobs, error: jErr } = await supabase.from('publishing_jobs').select('post_candidate_id');
  if (jErr) throw new Error(jErr.message);
  const has = new Set((jobs ?? []).map((r) => r.post_candidate_id as string));

  const { data: candidates, error: cErr } = await supabase
    .from('post_candidates')
    .select(PUBLISHING_CANDIDATE_PREP_COLUMNS)
    .eq('status', 'approved');
  if (cErr) throw new Error(cErr.message);

  return (candidates ?? []).filter((c) => !has.has(c.id)) as PostCandidateRow[];
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const singleCandidateId = parseCandidateIdArg();
  if (singleCandidateId) {
    if (parseValidateOnlyArg()) {
      pubLog('single-candidate validate-only', { candidateId: singleCandidateId });
      await validatePublishingForCandidate(supabase, singleCandidateId);
    } else {
      pubLog('single-candidate mode', { candidateId: singleCandidateId });
      await preparePublishingForCandidate(supabase, singleCandidateId);
    }
    return;
  }

  const openStatuses = [...OPEN_PUBLISHING_JOB_STATUSES];
  const { data: openJobs, error: oErr } = await supabase
    .from('publishing_jobs')
    .select('id, post_candidate_id, status')
    .in('status', openStatuses);
  if (oErr) throw new Error(oErr.message);

  const candIds = [...new Set((openJobs ?? []).map((j) => j.post_candidate_id as string))];
  const candStatusById = new Map<string, string>();
  if (candIds.length > 0) {
    const { data: cRows, error: cErr } = await supabase
      .from('post_candidates')
      .select('id,status')
      .in('id', candIds);
    if (cErr) throw new Error(cErr.message);
    for (const r of cRows ?? []) {
      candStatusById.set(r.id as string, r.status as string);
    }
  }

  const resumeJobs = (openJobs ?? []).filter((j) => {
    const cid = j.post_candidate_id as string;
    const st = candStatusById.get(cid);
    if (!st) return false;
    const js = j.status as string;
    if (js === 'scheduled') return false;
    if (isStageableCandidateStatus(st)) return true;
    if (st === 'ready_to_publish' && js !== 'ready_to_publish') return true;
    return false;
  });

  console.log(`[prepare:publishing]\tresume jobs: ${resumeJobs.length} (scheduled jobs use publish:scheduled)`);
  for (const j of resumeJobs) {
    const st = candStatusById.get(j.post_candidate_id as string) ?? '?';
    pubLog('resume queue item', { jobId: j.id, post_candidate_id: j.post_candidate_id, jobStatus: j.status, candidateStatus: st });
  }

  for (const j of resumeJobs) {
    try {
      await processPublishingJob(supabase, j.id as string);
    } catch (e) {
      console.error(`[prepare:publishing]\tjob ${j.id}`, e);
      if (e instanceof Error && e.stack) console.error(e.stack);
    }
  }
}

const isMainModule =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exit(1);
  });
}
