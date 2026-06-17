/**
 * Auto-ingest tick: Drive inbox → analyze → rename → geocode → post candidates.
 * Gated by pipeline_settings.auto_ingest_enabled; auto-pauses at needs_review threshold.
 *
 * Usage: npm run auto:ingest-tick
 */
import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { analyzePendingAssets } from './analyze-content-assets.js';
import { generatePostCandidates } from './generate-post-candidates.js';
import { ingestDriveFolder } from './ingest-drive-content.js';
import { processAnalyzedAssets } from './process-analyzed-assets.js';
import { reverseGeocodePendingAssets } from './reverse-geocode-assets.js';

const PIPELINE_SINGLETON = true;

type PipelineRow = {
  auto_ingest_enabled: boolean;
  auto_pause_threshold: number;
  auto_ingest_interval_minutes: number;
  last_run_finished_at: string | null;
};

type AutoIngestStage = 'full' | 'candidates_only' | 'assets_only';

function resolveAutoIngestStage(): AutoIngestStage {
  const raw = process.env.AUTO_INGEST_STAGE?.trim();
  if (raw === 'candidates_only') return 'candidates_only';
  if (raw === 'assets_only') return 'assets_only';
  return 'full';
}

function resolvePostCandidateSeriesSlug(): string | null {
  const raw = process.env.POST_CANDIDATE_SERIES_SLUG?.trim();
  return raw || null;
}

function isScheduledGithubEvent(): boolean {
  return process.env.GITHUB_EVENT_NAME?.trim() === 'schedule';
}

type TickSummary = {
  ingested: number;
  analyzed: number;
  processed: number;
  geocoded: number;
  candidates_created: number;
  needs_review_count_after: number;
  series_slug?: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

function truncate(msg: string, max = 2000): string {
  return msg.length <= max ? msg : `${msg.slice(0, max)}…`;
}

function getSupabase(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadPipeline(supabase: SupabaseClient): Promise<PipelineRow> {
  const { data, error } = await supabase
    .from('pipeline_settings')
    .select('auto_ingest_enabled,auto_pause_threshold,auto_ingest_interval_minutes,last_run_finished_at')
    .eq('singleton', PIPELINE_SINGLETON)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error('pipeline_settings row missing; apply migration 20260513120000_pipeline_settings.sql');
  }
  const row = data as PipelineRow;
  return {
    ...row,
    auto_ingest_interval_minutes: row.auto_ingest_interval_minutes ?? 30,
  };
}

function shouldSkipIntervalGate(settings: PipelineRow): boolean {
  if (!isScheduledGithubEvent()) return false;
  const finished = settings.last_run_finished_at;
  if (!finished) return false;
  const finishedMs = new Date(finished).getTime();
  if (Number.isNaN(finishedMs)) return false;
  const elapsedMs = Date.now() - finishedMs;
  const minMs = settings.auto_ingest_interval_minutes * 60_000;
  return elapsedMs < minMs;
}

async function needsReviewCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('post_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'needs_review');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countSince(
  supabase: SupabaseClient,
  table: 'content_assets' | 'post_candidates',
  sinceIso: string,
): Promise<number> {
  const dateColumn = table === 'content_assets' ? 'imported_at' : 'created_at';
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .gte(dateColumn, sinceIso);
  if (error) {
    const detail = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
    throw new Error(detail || `countSince failed on ${table}`);
  }
  return count ?? 0;
}

async function countAssetsUpdatedSince(
  supabase: SupabaseClient,
  sinceIso: string,
  status: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('content_assets')
    .select('id', { count: 'exact', head: true })
    .eq('status', status)
    .gte('updated_at', sinceIso);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countGeocodedSince(supabase: SupabaseClient, sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('content_assets')
    .select('id', { count: 'exact', head: true })
    .not('geo_label', 'is', null)
    .gte('updated_at', sinceIso);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function patchPipeline(
  supabase: SupabaseClient,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('pipeline_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('singleton', PIPELINE_SINGLETON);
  if (error) throw new Error(error.message);
}

export async function runAutoIngestTick(): Promise<void> {
  const supabase = getSupabase();
  const settings = await loadPipeline(supabase);
  const needsReview = await needsReviewCount(supabase);
  const stage = resolveAutoIngestStage();
  const seriesSlug = resolvePostCandidateSeriesSlug();

  console.log(
    `[auto-ingest]\tstage=${stage}\tenabled=${settings.auto_ingest_enabled}\tneeds_review=${needsReview}\tthreshold=${settings.auto_pause_threshold}\tinterval_min=${settings.auto_ingest_interval_minutes}` +
      (seriesSlug ? `\tseries=${seriesSlug}` : ''),
  );

  if (!settings.auto_ingest_enabled && isScheduledGithubEvent()) {
    console.log('[auto-ingest]\tdisabled; exiting');
    return;
  }

  if (shouldSkipIntervalGate(settings)) {
    console.log(
      `[auto-ingest]\tskipped_interval_gate: last finished ${settings.last_run_finished_at}, interval ${settings.auto_ingest_interval_minutes}m`,
    );
    return;
  }

  if (needsReview >= settings.auto_pause_threshold && isScheduledGithubEvent()) {
    await patchPipeline(supabase, {
      auto_ingest_enabled: false,
      last_run_status: 'paused_threshold_reached',
      last_run_summary: { needs_review_count: needsReview, threshold: settings.auto_pause_threshold },
    });
    console.log(
      `[auto-ingest]\tpaused: needs_review (${needsReview}) >= threshold (${settings.auto_pause_threshold})`,
    );
    return;
  }

  const startedAt = new Date().toISOString();
  await patchPipeline(supabase, {
    last_run_started_at: startedAt,
    last_run_status: 'running',
    last_run_summary: seriesSlug ? { series_slug: seriesSlug } : null,
  });

  let summary: TickSummary = {
    ingested: 0,
    analyzed: 0,
    processed: 0,
    geocoded: 0,
    candidates_created: 0,
    needs_review_count_after: needsReview,
  };

  try {
    if (stage === 'full' || stage === 'assets_only') {
      console.log('[auto-ingest]\tstep: ingest');
      await ingestDriveFolder();

      console.log('[auto-ingest]\tstep: analyze');
      await analyzePendingAssets();

      if (stage === 'assets_only') {
        console.log('[auto-ingest]\tstep: geocode');
        await reverseGeocodePendingAssets();

        console.log('[auto-ingest]\tstep: process (rename/move)');
        await processAnalyzedAssets();
      } else {
        console.log('[auto-ingest]\tstep: process (rename/move)');
        await processAnalyzedAssets();

        console.log('[auto-ingest]\tstep: geocode');
        await reverseGeocodePendingAssets();
      }
    } else {
      console.log('[auto-ingest]\tskipping ingest/analyze/process/geocode (candidates_only)');
    }

    if (stage !== 'assets_only') {
      console.log('[auto-ingest]\tstep: generate post candidates');
      await generatePostCandidates(seriesSlug ? { seriesSlug } : undefined);
    } else {
      console.log('[auto-ingest]\tskipping post candidates (assets_only)');
    }

    summary = {
      ingested: await countSince(supabase, 'content_assets', startedAt),
      analyzed: await countAssetsUpdatedSince(supabase, startedAt, 'analyzed'),
      processed: await countAssetsUpdatedSince(supabase, startedAt, 'processed'),
      geocoded: await countGeocodedSince(supabase, startedAt),
      candidates_created: await countSince(supabase, 'post_candidates', startedAt),
      needs_review_count_after: await needsReviewCount(supabase),
      ...(seriesSlug ? { series_slug: seriesSlug } : {}),
    };

    const finishedAt = new Date().toISOString();
    const newNeedsReview = summary.needs_review_count_after;

    if (newNeedsReview >= settings.auto_pause_threshold) {
      await patchPipeline(supabase, {
        auto_ingest_enabled: false,
        last_run_finished_at: finishedAt,
        last_run_status: 'paused_threshold_reached',
        last_run_summary: summary,
      });
      console.log(
        `[auto-ingest]\tfinished; auto-paused (needs_review=${newNeedsReview} >= ${settings.auto_pause_threshold})`,
      );
    } else {
      await patchPipeline(supabase, {
        last_run_finished_at: finishedAt,
        last_run_status: 'ok',
        last_run_summary: summary,
      });
      console.log('[auto-ingest]\tfinished ok', JSON.stringify(summary));
    }
  } catch (e) {
    const msg = truncate(e instanceof Error ? e.message : String(e));
    await patchPipeline(supabase, {
      last_run_finished_at: new Date().toISOString(),
      last_run_status: 'error',
      last_run_summary: { ...summary, error: msg },
    });
    console.error('[auto-ingest]\terror', msg);
    throw e;
  }
}

function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  runAutoIngestTick().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
