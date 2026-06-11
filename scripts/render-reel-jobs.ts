/**
 * Process queued reel `production_jobs` with FFmpeg; upload MP4 to public Supabase bucket.
 * Run: npm run render:reels
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getDriveClient } from './ingest-drive-content.js';
import { fetchDriveFileMedia, maxPublishingFileBytes } from './lib/drive-media-download.js';
import { formatGoogleDriveApiError } from './lib/google-drive-auth.js';
import { renderReel } from './lib/production/render-reel.js';
import { uploadPublicMedia } from './lib/publishing/public-upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

for (const envPath of [path.join(repoRoot, '.env'), path.join(repoRoot, '.env.local')]) {
  dotenv.config({ path: envPath });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

type ProductionJobRow = {
  id: string;
  post_candidate_id: string;
  production_type: string;
  status: string;
  source_asset_ids: string[] | null;
  instructions: unknown;
  reel_specification: unknown;
};

/** clips-v1 specs carry their own asset ordering (unique asset ids by first appearance). */
function assetIdsFromSpec(spec: unknown): string[] | null {
  if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const o = spec as Record<string, unknown>;
  if (o.version !== 'clips-v1' || !Array.isArray(o.clips)) return null;
  const ids: string[] = [];
  for (const c of o.clips) {
    if (c == null || typeof c !== 'object') continue;
    const id = (c as Record<string, unknown>).asset_id;
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : null;
}

type AssetRow = {
  id: string;
  drive_file_id: string | null;
  media_type: string | null;
  mime_type: string | null;
};

async function setJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const payload = { ...patch, updated_at: new Date().toISOString() };
  // production_jobs added in migration; not in generated Database typings
  const { error } = await supabase.from('production_jobs').update(payload).eq('id', jobId);
  if (error) throw new Error(error.message);
}

async function processOneJob(
  supabase: SupabaseClient,
  drive: Awaited<ReturnType<typeof getDriveClient>>,
  job: ProductionJobRow,
): Promise<void> {
  const jobId = job.id;
  const candidateId = job.post_candidate_id;
  const spec = job.reel_specification ?? job.instructions;
  const specAssetIds = assetIdsFromSpec(spec);
  const rawIds =
    specAssetIds ??
    (Array.isArray(job.source_asset_ids) ? job.source_asset_ids.filter(Boolean) : []);
  const uniqueIds = [...new Set(rawIds)];

  if (uniqueIds.length === 0) {
    await setJob(supabase, jobId, {
      status: 'needs_manual_production',
      error_message: 'No source_asset_ids on production job; need 1–3 video assets.',
      render_log: { reason: 'asset_count' },
    });
    return;
  }

  if (uniqueIds.length > 3) {
    await setJob(supabase, jobId, {
      status: 'needs_manual_production',
      error_message: `Reel v1 supports 1–3 source videos; this job has ${uniqueIds.length}.`,
      render_log: { reason: 'too_many_assets', count: uniqueIds.length },
    });
    return;
  }

  const { data: assets, error: aErr } = await supabase
    .from('content_assets')
    .select('id, drive_file_id, media_type, mime_type')
    .in('id', uniqueIds);

  if (aErr) throw new Error(aErr.message);

  const byId = new Map<string, AssetRow>();
  for (const a of assets ?? []) {
    byId.set((a as AssetRow).id, a as AssetRow);
  }

  const ordered: AssetRow[] = [];
  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) {
      await setJob(supabase, jobId, {
        status: 'needs_manual_production',
        error_message: `Unknown content_asset id: ${id}`,
        render_log: { reason: 'unknown_asset' },
      });
      return;
    }
    const mt = (row.media_type ?? '').trim().toLowerCase();
    if (mt !== 'video') {
      await setJob(supabase, jobId, {
        status: 'needs_manual_production',
        error_message: `Asset ${id} is not video (media_type=${row.media_type ?? 'n/a'}).`,
        render_log: { reason: 'non_video' },
      });
      return;
    }
    if (!row.drive_file_id?.trim()) {
      await setJob(supabase, jobId, {
        status: 'needs_manual_production',
        error_message: `Asset ${id} has no drive_file_id.`,
        render_log: { reason: 'missing_drive' },
      });
      return;
    }
    ordered.push(row);
  }

  const maxBytes = maxPublishingFileBytes();
  const buffers: Buffer[] = [];
  for (const row of ordered) {
    try {
      const buf = await fetchDriveFileMedia(drive, row.drive_file_id!, maxBytes);
      buffers.push(buf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await setJob(supabase, jobId, {
        status: 'needs_manual_production',
        error_message: `Drive download failed for asset ${row.id}: ${formatGoogleDriveApiError(e)}`,
        render_log: { reason: 'drive_download', detail: msg },
      });
      return;
    }
  }

  await setJob(supabase, jobId, { status: 'rendering', error_message: null });

  let rendered: Awaited<ReturnType<typeof renderReel>>;
  try {
    rendered = await renderReel({
      sourceVideos: buffers,
      instructions: spec,
      sourceAssetIds: ordered.map((r) => r.id),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setJob(supabase, jobId, {
      status: 'failed',
      error_message: msg,
      render_log: { stage: 'ffmpeg', error: msg },
    });
    return;
  }

  const bucket = requireEnv('PUBLIC_MEDIA_BUCKET_NAME');
  const publicBase = requireEnv('PUBLIC_MEDIA_BASE_URL');
  const objectPath = `instagram/production/${candidateId}/${jobId}.mp4`;

  let publicUrl: string;
  try {
    const up = await uploadPublicMedia({
      supabase,
      bucket,
      publicBaseUrl: publicBase,
      objectPath,
      body: rendered.mp4,
      contentType: 'video/mp4',
    });
    publicUrl = up.publicUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setJob(supabase, jobId, {
      status: 'failed',
      error_message: `Upload failed: ${msg}`,
      render_log: { ...rendered.log, stage: 'upload' },
    });
    return;
  }

  let thumbnailUrl: string | null = null;
  if (rendered.thumbnailJpeg?.length) {
    try {
      const up = await uploadPublicMedia({
        supabase,
        bucket,
        publicBaseUrl: publicBase,
        objectPath: `instagram/production/${candidateId}/${jobId}.jpg`,
        body: rendered.thumbnailJpeg,
        contentType: 'image/jpeg',
      });
      thumbnailUrl = up.publicUrl;
    } catch (e) {
      console.warn(`[render:reels]\tthumbnail upload failed\t${jobId}`, e);
    }
  }

  await setJob(supabase, jobId, {
    status: 'produced',
    output_video_url: publicUrl,
    thumbnail_url: thumbnailUrl,
    render_strategy: 'ffmpeg-deterministic-v2',
    render_log: rendered.log,
    reel_specification: spec ?? null,
    error_message: null,
  });

  // Attach the rendered preview to the candidate so the review UI surfaces it.
  if (thumbnailUrl) {
    try {
      const { error } = await supabase
        .from('post_candidates')
        .update({ cover_thumbnail_url: thumbnailUrl, updated_at: new Date().toISOString() })
        .eq('id', candidateId)
        .is('cover_thumbnail_url', null);
      if (error) console.warn(`[render:reels]\tcandidate thumb attach failed\t${candidateId}: ${error.message}`);
    } catch (e) {
      console.warn(`[render:reels]\tcandidate thumb attach failed\t${candidateId}`, e);
    }
  }
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: jobs, error } = await supabase
    .from('production_jobs')
    .select('id,post_candidate_id,production_type,status,source_asset_ids,instructions,reel_specification')
    .eq('production_type', 'reel')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  const list = (jobs ?? []) as ProductionJobRow[];
  console.log(`[render:reels]\tqueued jobs: ${list.length}`);

  const drive = await getDriveClient();

  for (const job of list) {
    try {
      await processOneJob(supabase, drive, job);
      console.log(`[render:reels]\tdone\t${job.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[render:reels]\tfail\t${job.id}\t${msg}`);
      try {
        await setJob(supabase, job.id, {
          status: 'failed',
          error_message: msg,
        });
      } catch (e2) {
        console.error('[render:reels]\tcould not persist failure', e2);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
