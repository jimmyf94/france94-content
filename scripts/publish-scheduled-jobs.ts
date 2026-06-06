/**
 * Run due scheduled Instagram jobs: media prep -> Graph containers -> poll -> media_publish.
 * Run periodically via cron (e.g. every five minutes): cd /path/to/repo && npm run publish:scheduled
 *
 * Single job (e.g. Publish now): npm run publish:scheduled -- --job-id=<uuid>
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { processPublishingJob } from './prepare-publishing-jobs.js';
import {
  getInstagramContainerStatus,
  publishPublishingJob,
  refreshPublishingJobFromGraph,
  updatePublishingJob,
} from './lib/publishing/index.js';
import { isFinished } from './lib/publishing/instagram-graph.js';
import type { PublishingJobStatus } from './lib/publishing/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

for (const envPath of [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')]) {
  dotenv.config({ path: envPath });
}

const DUE_WORKER_STATUSES: PublishingJobStatus[] = [
  'scheduled',
  'media_prepared',
  'processing',
  'containers_created',
  'ready_to_publish',
];

const POLL_INTERVAL_MS = 15_000;
const POLL_BUDGET_MS = 90_000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function parseJobIdArg(): string | undefined {
  const fromEquals = process.argv.find((a) => a.startsWith('--job-id='));
  if (fromEquals) {
    const v = fromEquals.slice('--job-id='.length).trim();
    if (v) return v;
  }
  const idx = process.argv.indexOf('--job-id');
  if (idx >= 0) {
    const v = process.argv[idx + 1]?.trim();
    if (v && !v.startsWith('-')) return v;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type JobRow = Record<string, unknown>;

function containerIdsToPoll(row: JobRow): string[] {
  const childIds = Array.isArray(row.instagram_child_container_ids)
    ? (row.instagram_child_container_ids as string[]).filter((x) => typeof x === 'string' && x.trim())
    : [];
  const parentId =
    typeof row.instagram_parent_container_id === 'string' && row.instagram_parent_container_id.trim()
      ? row.instagram_parent_container_id.trim()
      : null;
  const creationId =
    typeof row.instagram_creation_id === 'string' && row.instagram_creation_id.trim()
      ? row.instagram_creation_id.trim()
      : null;

  if (childIds.length > 0) {
    const ids = [...childIds];
    if (parentId) ids.push(parentId);
    return ids;
  }
  if (creationId) return [creationId];
  return [];
}

async function areJobContainersPublishReady(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data: row, error } = await supabase
    .from('publishing_jobs')
    .select(
      'status, publish_type, instagram_creation_id, instagram_child_container_ids, instagram_parent_container_id',
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return false;

  const r = row as JobRow;
  if (String(r.status ?? '') === 'failed') return false;

  const publishType = String(r.publish_type ?? '');
  const childIds = Array.isArray(r.instagram_child_container_ids)
    ? (r.instagram_child_container_ids as string[]).filter((x) => typeof x === 'string' && x.trim())
    : [];
  const creationId =
    typeof r.instagram_creation_id === 'string' && r.instagram_creation_id.trim()
      ? r.instagram_creation_id.trim()
      : null;

  let targets: string[] = [];
  if (publishType === 'story_sequence' && childIds.length > 0) {
    targets = childIds;
  } else {
    targets = containerIdsToPoll(r);
  }
  if (targets.length === 0) return false;

  for (const id of targets) {
    const p = await getInstagramContainerStatus(id);
    if (!isFinished(p.status_code)) return false;
  }
  return true;
}

async function pollUntilPublishReady(
  supabase: SupabaseClient,
  jobId: string,
): Promise<'ready' | 'failed' | 'timeout'> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const { data: row } = await supabase
      .from('publishing_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    const st = String((row as { status?: string } | null)?.status ?? '');
    if (st === 'failed') return 'failed';
    if (st === 'published') return 'ready';

    if (await areJobContainersPublishReady(supabase, jobId)) {
      return 'ready';
    }

    await refreshPublishingJobFromGraph(supabase, jobId);

    const { data: after } = await supabase
      .from('publishing_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    const afterSt = String((after as { status?: string } | null)?.status ?? '');
    if (afterSt === 'failed') return 'failed';
    if (afterSt === 'published') return 'ready';
    if (await areJobContainersPublishReady(supabase, jobId)) {
      return 'ready';
    }

    await sleep(POLL_INTERVAL_MS);
  }
  return 'timeout';
}

export async function runDuePublishingJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ mediaId: string | null; permalink: string | null } | null> {
  const { data: row, error } = await supabase
    .from('publishing_jobs')
    .select('id, status, scheduled_publish_at')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error(`Publishing job not found: ${jobId}`);

  const st = String((row as { status?: string }).status ?? '');
  if (st === 'published') {
    console.log(`[publish:scheduled]\tskip\t${jobId}\talready published`);
    return null;
  }
  if (st === 'publishing') {
    console.log(`[publish:scheduled]\tskip\t${jobId}\talready publishing`);
    return null;
  }

  console.log(`[publish:scheduled]\tstart\t${jobId}\tstatus=${st}`);

  await processPublishingJob(supabase, jobId);

  const { data: afterPrep } = await supabase
    .from('publishing_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle();
  const prepStatus = String((afterPrep as { status?: string } | null)?.status ?? '');
  if (prepStatus === 'failed') {
    console.error(`[publish:scheduled]\tfail\t${jobId}\tprep failed`);
    return null;
  }

  const pollResult = await pollUntilPublishReady(supabase, jobId);
  if (pollResult === 'failed') {
    console.error(`[publish:scheduled]\tfail\t${jobId}\tcontainers failed`);
    return null;
  }
  if (pollResult === 'timeout') {
    console.log(`[publish:scheduled]\twait\t${jobId}\tcontainers still processing; will retry next tick`);
    return null;
  }

  const { data: beforePublish } = await supabase
    .from('publishing_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle();
  const publishStatus = String((beforePublish as { status?: string } | null)?.status ?? '');
  if (publishStatus !== 'scheduled' && publishStatus !== 'ready_to_publish') {
    await updatePublishingJob(supabase, jobId, { status: 'scheduled' });
  }

  const result = await publishPublishingJob(supabase, jobId);
  console.log(
    `[publish:scheduled]\tok\t${jobId}\tmedia=${result.mediaId ?? 'n/a'}\tpermalink=${result.permalink ?? 'n/a'}`,
  );
  return result;
}

async function fetchDueJobs(supabase: SupabaseClient): Promise<Array<{ id: string }>> {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from('publishing_jobs')
    .select('id,post_candidate_id,scheduled_publish_at,status')
    .in('status', DUE_WORKER_STATUSES)
    .not('scheduled_publish_at', 'is', null)
    .lte('scheduled_publish_at', nowIso)
    .order('scheduled_publish_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (rows ?? []).map((r) => ({ id: r.id as string }));
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const singleJobId = parseJobIdArg();
  if (singleJobId) {
    console.log(`[publish:scheduled]\tsingle-job mode\t${singleJobId}`);
    try {
      await runDuePublishingJob(supabase, singleJobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[publish:scheduled]\tfail\t${singleJobId}\t${msg}`);
      if (e instanceof Error && e.stack) console.error(e.stack);
      process.exit(1);
    }
    console.log('[publish:scheduled]\tdone');
    return;
  }

  const jobs = await fetchDueJobs(supabase);
  const nowIso = new Date().toISOString();
  console.log(`[publish:scheduled]\tfound ${jobs.length} due job(s) at ${nowIso}`);

  for (const j of jobs) {
    try {
      await runDuePublishingJob(supabase, j.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[publish:scheduled]\tfail\t${j.id}\t${msg}`);
      if (e instanceof Error && e.stack) console.error(e.stack);
    }
  }

  console.log('[publish:scheduled]\tdone');
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
