import type { drive_v3 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Cooldown before story-used assets may be suggested again (days). */
export const STORY_REUSE_COOLDOWN_DAYS = 14;
/** Lane-level cooldown after approval (days). */
export const LANE_COOLDOWN_DAYS_REEL = 1;
export const LANE_COOLDOWN_DAYS_STORY = 2;
export const LANE_COOLDOWN_DAYS_DEFAULT = 5;

export function computeLaneCooldownUntil(
  postType: string | null | undefined,
  from = new Date(),
): string {
  const t = (postType ?? '').trim();
  let days = LANE_COOLDOWN_DAYS_DEFAULT;
  if (t === 'reel') days = LANE_COOLDOWN_DAYS_REEL;
  else if (t === 'story' || t === 'story_sequence') days = LANE_COOLDOWN_DAYS_STORY;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
/** Story / story_sequence must use assets with effective capture within this window (hours). */
export const STORY_FRESHNESS_HOURS = 48;
/** Reserved-asset warning horizon (reserved for future UX; not enforced in DB yet). */
export const APPROVED_RESERVATION_WARNING_DAYS = 14;

/**
 * Instagram `media_publish` is not implemented in-repo; we treat `ready_to_publish` as the
 * operational moment to record final published usage for warning/reporting purposes.
 */
export const APPLY_ASSET_LOCKS_AT_READY_TO_PUBLISH = true;

export type ContentAssetDateFields = {
  id: string;
  capture_time?: string | null;
  drive_created_time?: string | null;
  processed_at?: string | null;
  imported_at?: string | null;
  usage_status?: string | null;
  last_used_at?: string | null;
  last_published_at?: string | null;
  reuse_allowed_after?: string | null;
  usage_count?: number | null;
  hard_locked?: boolean | null;
};

export type CandidateLike = {
  id: string;
  post_type?: string | null;
  title?: string | null;
  concept_summary?: string | null;
  hook?: string | null;
  source_asset_ids?: string[] | null;
  status?: string | null;
  publishing_job_id?: string | null;
};

const RECAP_KEYWORDS = /\b(recap|throwback|archive|archives|flashback|monthly\s*recap|retrospective)\b/i;

export function getCandidateAssetIds(candidate: CandidateLike): string[] {
  const raw = candidate.source_asset_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export function getAssetEffectiveDate(asset: ContentAssetDateFields): string | null {
  const pick = asset.capture_time || asset.drive_created_time || asset.processed_at || asset.imported_at;
  if (!pick || typeof pick !== 'string') return null;
  const t = Date.parse(pick);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function isFreshForStory(asset: ContentAssetDateFields, now = new Date()): boolean {
  const eff = getAssetEffectiveDate(asset);
  if (!eff) return false;
  const t = Date.parse(eff);
  if (!Number.isFinite(t)) return false;
  const min = now.getTime() - STORY_FRESHNESS_HOURS * 3600 * 1000;
  return t >= min;
}

export function isStoryPostType(postType: string | null | undefined): boolean {
  const t = (postType ?? '').trim();
  return t === 'story' || t === 'story_sequence';
}

export function isRecapLikeCandidate(candidate: CandidateLike): boolean {
  const pt = (candidate.post_type ?? '').trim();
  if (pt === 'archive_note') return true;
  const blob = [candidate.title, candidate.concept_summary, candidate.hook].filter(Boolean).join(' ');
  return RECAP_KEYWORDS.test(blob);
}

export function mapPostTypeToUsageType(postType: string | null | undefined): string {
  const t = (postType ?? '').trim();
  if (t === 'static_post') return 'static_post';
  if (t === 'carousel') return 'carousel';
  if (t === 'reel') return 'reel';
  if (t === 'story' || t === 'story_sequence') return t;
  if (t === 'sponsor_post') return 'sponsor_post';
  if (t === 'monthly_recap') return 'monthly_recap';
  return 'other';
}

export function computeAssetReusePolicy(postType: string | null | undefined): {
  lockStrength: 'hard' | 'soft';
  cooldownDays: number;
} {
  const t = (postType ?? '').trim();
  if (t === 'story' || t === 'story_sequence') {
    return { lockStrength: 'soft', cooldownDays: STORY_REUSE_COOLDOWN_DAYS };
  }
  return { lockStrength: 'soft', cooldownDays: 0 };
}

/** Maps ledger usage_stage to v0.8 event_kind vocabulary (override for manual_* etc.). */
export function mapUsageStageToEventKind(usageStage: string): string {
  const s = (usageStage ?? '').trim();
  switch (s) {
    case 'suggested':
      return 'suggested';
    case 'approved':
      return 'approved_candidate';
    case 'scheduled':
      return 'scheduled';
    case 'published':
      return 'published';
    case 'rejected':
      return 'rejected';
    case 'released':
      return 'released';
    case 'expired':
      return 'expired';
    default:
      return s || 'unknown';
  }
}

export type RecordAssetUsageEventParams = {
  contentAssetId: string;
  postCandidateId: string | null;
  publishingJobId: string | null;
  usageStage: string;
  usageType: string;
  usageRole?: string | null;
  platform?: string;
  publishedAt?: string | null;
  reuseAllowedAfter?: string | null;
  lockStrength?: 'soft' | 'hard';
  notes?: string | null;
  /** When set, stored as asset_usage_events.event_kind (else derived from usageStage). */
  eventKind?: string | null;
  /** Stored as asset_usage_events.post_type; defaults to usageType. */
  ledgerPostType?: string | null;
  /** When set, used as asset_usage_events.used_at (ISO). */
  usedAt?: string | null;
};

export async function recordAssetUsageEvent(
  supabase: SupabaseClient,
  params: RecordAssetUsageEventParams,
): Promise<void> {
  const now = new Date().toISOString();
  const usedAt = params.usedAt?.trim() || now;
  const eventKind =
    (params.eventKind && params.eventKind.trim()) || mapUsageStageToEventKind(params.usageStage);
  const ledgerPostType = (params.ledgerPostType && params.ledgerPostType.trim()) || params.usageType;
  const row = {
    content_asset_id: params.contentAssetId,
    post_candidate_id: params.postCandidateId,
    publishing_job_id: params.publishingJobId,
    usage_stage: params.usageStage,
    usage_type: params.usageType,
    usage_role: params.usageRole ?? null,
    platform: params.platform ?? 'instagram',
    used_at: usedAt,
    published_at: params.publishedAt ?? null,
    reuse_allowed_after: params.reuseAllowedAfter ?? null,
    lock_strength: params.lockStrength ?? 'soft',
    notes: params.notes ?? null,
    created_at: now,
    event_kind: eventKind,
    post_type: ledgerPostType,
  };
  const { error } = await supabase.from('asset_usage_events').insert(row);
  if (error) throw new Error(`recordAssetUsageEvent: ${error.message}`);

  if ((params.usageStage ?? '').trim() === 'suggested') {
    const { data: cur, error: readErr } = await supabase
      .from('content_assets')
      .select('suggestion_count')
      .eq('id', params.contentAssetId)
      .maybeSingle();
    if (readErr) throw new Error(`recordAssetUsageEvent(suggestion_count read): ${readErr.message}`);
    const n = typeof (cur as { suggestion_count?: number } | null)?.suggestion_count === 'number'
      ? (cur as { suggestion_count: number }).suggestion_count
      : 0;
    const { error: bumpErr } = await supabase
      .from('content_assets')
      .update({
        suggestion_count: n + 1,
        last_suggested_at: usedAt,
        updated_at: now,
      })
      .eq('id', params.contentAssetId);
    if (bumpErr) throw new Error(`recordAssetUsageEvent(suggestion bump): ${bumpErr.message}`);
  }
}

async function fetchActiveEvents(supabase: SupabaseClient, assetId: string) {
  const { data, error } = await supabase
    .from('asset_usage_events')
    .select('usage_stage,lock_strength,usage_type,reuse_allowed_after,published_at,used_at')
    .eq('content_asset_id', assetId)
    .not('usage_stage', 'eq', 'released')
    .not('usage_stage', 'eq', 'rejected')
    .not('usage_stage', 'eq', 'expired');
  if (error) throw new Error(`fetchActiveEvents: ${error.message}`);
  return data ?? [];
}

function maxIso(dates: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    const t = Date.parse(d);
    if (!Number.isFinite(t)) continue;
    if (best == null || t > best) {
      best = t;
      bestIso = d;
    }
  }
  return bestIso;
}

function isBlockingUsageEvent(
  e: { usage_stage?: string; lock_strength?: string; usage_type?: string; reuse_allowed_after?: string | null },
  nowMs: number,
): boolean {
  const stage = (e.usage_stage ?? '').trim();
  if (stage !== 'published') return true;
  const soft = (e.lock_strength ?? 'soft') === 'soft';
  const story = (e.usage_type ?? '') === 'story' || (e.usage_type ?? '') === 'story_sequence';
  if (soft && story && e.reuse_allowed_after && Date.parse(e.reuse_allowed_after) <= nowMs) {
    return false;
  }
  return true;
}

/**
 * Recompute content_assets summary fields from asset_usage_events (non-released/rejected).
 */
export async function updateAssetUsageSummary(supabase: SupabaseClient, assetId: string): Promise<void> {
  const events = await fetchActiveEvents(supabase, assetId);
  const now = Date.now();
  const activeEvents = events.filter((e) => isBlockingUsageEvent(e, now));

  if (activeEvents.length === 0) {
    const { error } = await supabase
      .from('content_assets')
      .update({
        usage_status: 'unused',
        last_used_at: null,
        last_published_at: null,
        reuse_allowed_after: null,
        usage_count: events.length,
        hard_locked: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assetId);
    if (error) throw new Error(`updateAssetUsageSummary(clear): ${error.message}`);
    return;
  }

  const publishedAll = activeEvents.filter((e: { usage_stage?: string }) => e.usage_stage === 'published');
  const published = publishedAll;
  const scheduled = activeEvents.filter((e: { usage_stage?: string }) => e.usage_stage === 'scheduled');
  const approved = activeEvents.filter((e: { usage_stage?: string }) => e.usage_stage === 'approved');
  const suggested = activeEvents.filter((e: { usage_stage?: string }) => e.usage_stage === 'suggested');

  let usage_status = 'unused';
  let hard_locked = false;
  let last_published_at: string | null = null;
  let reuse_allowed_after: string | null = null;

  const softStoryPublished = published.filter(
    (e: { lock_strength?: string; usage_type?: string }) =>
      (e.lock_strength ?? 'soft') === 'soft' &&
      ((e.usage_type ?? '') === 'story' || (e.usage_type ?? '') === 'story_sequence'),
  );

  if (softStoryPublished.length > 0) {
    const anySoftStoryCooldown = softStoryPublished.some(
      (e: { reuse_allowed_after?: string | null }) =>
        e.reuse_allowed_after && Date.parse(e.reuse_allowed_after) > now,
    );
    if (anySoftStoryCooldown) {
      usage_status = 'story_used_reusable_later';
      hard_locked = false;
      const cooldownEnds = softStoryPublished
        .map((e: { reuse_allowed_after?: string | null }) => e.reuse_allowed_after)
        .filter(Boolean) as string[];
      reuse_allowed_after = cooldownEnds.length ? maxIso(cooldownEnds) : null;
    } else if (published.length > 0) {
      usage_status = 'published';
      hard_locked = false;
    }
    last_published_at =
      maxIso(publishedAll.map((e: { published_at?: string }) => e.published_at)) ??
      maxIso(publishedAll.map((e: { used_at?: string }) => e.used_at));
  } else if (published.length > 0) {
    usage_status = 'published';
    hard_locked = false;
    last_published_at =
      maxIso(published.map((e: { published_at?: string }) => e.published_at)) ??
      maxIso(published.map((e: { used_at?: string }) => e.used_at));
  } else if (scheduled.length > 0) {
    usage_status = 'scheduled';
    hard_locked = false;
  } else if (approved.length > 0) {
    usage_status = 'approved_pending';
    hard_locked = false;
  } else if (suggested.length > 0) {
    usage_status = 'suggested';
    hard_locked = false;
  }

  const last_used_at =
    maxIso(activeEvents.map((e: { used_at?: string }) => e.used_at)) ?? new Date().toISOString();

  const { error } = await supabase
    .from('content_assets')
    .update({
      usage_status,
      last_used_at,
      last_published_at,
      reuse_allowed_after,
      usage_count: activeEvents.length,
      hard_locked,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId);
  if (error) throw new Error(`updateAssetUsageSummary: ${error.message}`);
}

async function loadCandidate(supabase: SupabaseClient, candidateId: string): Promise<CandidateLike | null> {
  const { data, error } = await supabase
    .from('post_candidates')
    .select('id,post_type,title,concept_summary,hook,source_asset_ids,status,publishing_job_id')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(`loadCandidate: ${error.message}`);
  return data as CandidateLike | null;
}

async function loadAssets(
  supabase: SupabaseClient,
  assetIds: string[],
): Promise<Map<string, ContentAssetDateFields>> {
  if (assetIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('content_assets')
    .select(
      'id,capture_time,drive_created_time,processed_at,imported_at,usage_status,hard_locked,reuse_allowed_after',
    )
    .in('id', assetIds);
  if (error) throw new Error(`loadAssets: ${error.message}`);
  const m = new Map<string, ContentAssetDateFields>();
  for (const row of data ?? []) {
    m.set((row as { id: string }).id, row as ContentAssetDateFields);
  }
  return m;
}

export class AssetUsageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AssetUsageError';
  }
}

async function hasOtherApprovedReservation(
  supabase: SupabaseClient,
  assetId: string,
  excludeCandidateId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('asset_usage_events')
    .select('id')
    .eq('content_asset_id', assetId)
    .eq('usage_stage', 'approved')
    .neq('post_candidate_id', excludeCandidateId)
    .limit(1);
  if (error) throw new Error(`hasOtherApprovedReservation: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function hasOtherScheduledUsage(
  supabase: SupabaseClient,
  assetId: string,
  excludeCandidateId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('asset_usage_events')
    .select('id,post_candidate_id')
    .eq('content_asset_id', assetId)
    .eq('usage_stage', 'scheduled');
  if (error) throw new Error(`hasOtherScheduledUsage: ${error.message}`);
  for (const row of data ?? []) {
    const pcid = (row as { post_candidate_id?: string | null }).post_candidate_id;
    if (pcid && pcid !== excludeCandidateId) return true;
  }
  return false;
}

/**
 * Validates assets are available for approval and inserts `approved` usage events.
 * Call before updating post_candidates.status to approved (or after in same transaction flow).
 */
export async function reserveAssetsForCandidate(supabase: SupabaseClient, candidateId: string): Promise<void> {
  const candidate = await loadCandidate(supabase, candidateId);
  if (!candidate) throw new AssetUsageError('not_found', 'Candidate not found');
  const assetIds = getCandidateAssetIds(candidate);
  if (assetIds.length === 0) {
    throw new AssetUsageError('no_assets', 'Candidate has no source_asset_ids to reserve.');
  }

  const assets = await loadAssets(supabase, assetIds);

  for (const aid of assetIds) {
    const row = assets.get(aid);
    if (!row) throw new AssetUsageError('unknown_asset', `Unknown content_asset: ${aid}`);
  }

  // Idempotent: remove prior approved events for this candidate, then re-insert
  const { error: delErr } = await supabase
    .from('asset_usage_events')
    .delete()
    .eq('post_candidate_id', candidateId)
    .eq('usage_stage', 'approved');
  if (delErr) throw new Error(`reserveAssetsForCandidate(delete old): ${delErr.message}`);

  const usageType = mapPostTypeToUsageType(candidate.post_type);
  for (const aid of assetIds) {
    await recordAssetUsageEvent(supabase, {
      contentAssetId: aid,
      postCandidateId: candidateId,
      publishingJobId: null,
      usageStage: 'approved',
      usageType,
      ledgerPostType: candidate.post_type ?? null,
      usageRole: 'unknown',
      lockStrength: 'soft',
      notes: 'Reservation on human approval',
    });
    await updateAssetUsageSummary(supabase, aid);
  }

  await refreshCandidateAssetConflicts(supabase, candidateId);
  await refreshConflictsForAssets(supabase, assetIds);
}

const PUBLISHING_JOB_USAGE_STAGES_TO_RELEASE = ['scheduled', 'published'] as const;

/** Remove job-scoped scheduled/published usage rows; keeps approved candidate reservations. */
export async function releasePublishingJobUsage(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string[]> {
  const { data: events, error: evErr } = await supabase
    .from('asset_usage_events')
    .select('content_asset_id')
    .eq('publishing_job_id', jobId)
    .in('usage_stage', [...PUBLISHING_JOB_USAGE_STAGES_TO_RELEASE]);
  if (evErr) throw new Error(`releasePublishingJobUsage: ${evErr.message}`);

  const assetIds = [
    ...new Set(
      (events ?? [])
        .map((e: { content_asset_id?: string }) => e.content_asset_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const { error: delErr } = await supabase
    .from('asset_usage_events')
    .delete()
    .eq('publishing_job_id', jobId)
    .in('usage_stage', [...PUBLISHING_JOB_USAGE_STAGES_TO_RELEASE]);
  if (delErr) throw new Error(`releasePublishingJobUsage(delete): ${delErr.message}`);

  for (const aid of assetIds) {
    await updateAssetUsageSummary(supabase, aid);
  }

  if (assetIds.length > 0) {
    await refreshConflictsForAssets(supabase, assetIds);
  }

  return assetIds;
}

export async function releaseAssetsForCandidate(supabase: SupabaseClient, candidateId: string): Promise<void> {
  const { data: events, error: evErr } = await supabase
    .from('asset_usage_events')
    .select('content_asset_id')
    .eq('post_candidate_id', candidateId)
    .eq('usage_stage', 'approved');
  if (evErr) throw new Error(`releaseAssetsForCandidate: ${evErr.message}`);

  const assetIds = [...new Set((events ?? []).map((e: { content_asset_id: string }) => e.content_asset_id))];

  const { error: delErr } = await supabase
    .from('asset_usage_events')
    .delete()
    .eq('post_candidate_id', candidateId)
    .eq('usage_stage', 'approved');
  if (delErr) throw new Error(`releaseAssetsForCandidate(delete): ${delErr.message}`);

  for (const aid of assetIds) {
    await updateAssetUsageSummary(supabase, aid);
  }

  if (assetIds.length > 0) {
    await refreshConflictsForAssets(supabase, assetIds);
  }
  await refreshCandidateAssetConflicts(supabase, candidateId);
}

/** Statuses where `usage_stage = approved` rows for this candidate are expected to exist. */
export const POST_CANDIDATE_STATUSES_HOLDING_APPROVED_RESERVATION: ReadonlySet<string> = new Set([
  'approved',
  'ready_to_publish',
  'in_production',
  'produced',
  'posted',
]);

async function candidateHasApprovedUsageEvents(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('asset_usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('post_candidate_id', candidateId)
    .eq('usage_stage', 'approved');
  if (error) throw new Error(`candidateHasApprovedUsageEvents: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * If the candidate is not in a pipeline status that should keep approved reservations
 * but `approved` usage rows still exist, clear them (historical orphans, failed releases, SQL edits).
 */
export async function releaseStaleApprovedReservationsIfNeeded(
  supabase: SupabaseClient,
  candidateId: string,
  candidateStatus: string,
): Promise<boolean> {
  const st = (candidateStatus ?? '').trim();
  if (POST_CANDIDATE_STATUSES_HOLDING_APPROVED_RESERVATION.has(st)) return false;
  if (!(await candidateHasApprovedUsageEvents(supabase, candidateId))) return false;
  await releaseAssetsForCandidate(supabase, candidateId);
  return true;
}

/**
 * Scan the ledger for approved rows tied to candidates whose status is not a holding status,
 * and release each such candidate once.
 */
export async function reconcileAllStaleApprovedReservations(
  supabase: SupabaseClient,
): Promise<{ repairedCandidateIds: string[] }> {
  const pageSize = 1000;
  const ids = new Set<string>();
  for (let from = 0; ; from += pageSize) {
    const { data: page, error: evErr } = await supabase
      .from('asset_usage_events')
      .select('post_candidate_id')
      .eq('usage_stage', 'approved')
      .not('post_candidate_id', 'is', null)
      .range(from, from + pageSize - 1);
    if (evErr) throw new Error(`reconcileAllStaleApprovedReservations(events): ${evErr.message}`);
    const rows = page ?? [];
    for (const r of rows) {
      const id = (r as { post_candidate_id: string | null }).post_candidate_id;
      if (id) ids.add(id);
    }
    if (rows.length < pageSize) break;
  }

  if (ids.size === 0) return { repairedCandidateIds: [] };

  const idList = [...ids];
  const repaired: string[] = [];
  const chunkSize = 80;
  for (let i = 0; i < idList.length; i += chunkSize) {
    const chunk = idList.slice(i, i + chunkSize);
    const { data: cands, error: cErr } = await supabase
      .from('post_candidates')
      .select('id, status')
      .in('id', chunk);
    if (cErr) throw new Error(`reconcileAllStaleApprovedReservations(candidates): ${cErr.message}`);
    for (const c of cands ?? []) {
      const cid = (c as { id: string }).id;
      const cst = ((c as { status?: string }).status ?? '').trim();
      if (POST_CANDIDATE_STATUSES_HOLDING_APPROVED_RESERVATION.has(cst)) continue;
      await releaseAssetsForCandidate(supabase, cid);
      repaired.push(cid);
    }
  }
  return { repairedCandidateIds: repaired };
}

/**
 * Clear `content_assets.usage_status = suggested` when no active suggested
 * ledger row exists. This repairs historical summary drift without releasing
 * real approved/scheduled/published locks.
 */
export async function reconcileStaleSuggestedUsageSummaries(
  supabase: SupabaseClient,
): Promise<{ repairedAssetIds: string[] }> {
  const pageSize = 1000;
  const candidateAssetIds: string[] = [];
  const repairedAssetIds: string[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('content_assets')
      .select('id')
      .eq('usage_status', 'suggested')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`reconcileStaleSuggestedUsageSummaries(assets): ${error.message}`);

    const rows = page ?? [];
    for (const row of rows) {
      const assetId = (row as { id?: string | null }).id;
      if (assetId) candidateAssetIds.push(assetId);
    }

    if (rows.length < pageSize) break;
  }

  for (const assetId of candidateAssetIds) {
    const active = await fetchActiveEvents(supabase, assetId);
    const hasSuggested = active.some((e: { usage_stage?: string | null }) => {
      return (e.usage_stage ?? '').trim() === 'suggested';
    });
    if (hasSuggested) continue;

    await updateAssetUsageSummary(supabase, assetId);
    repairedAssetIds.push(assetId);
  }

  return { repairedAssetIds };
}

async function hasScheduledEventsForJob(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('asset_usage_events')
    .select('id')
    .eq('publishing_job_id', jobId)
    .eq('usage_stage', 'scheduled')
    .limit(1);
  if (error) throw new Error(`hasScheduledEventsForJob: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

async function hasPublishedEventsForJob(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('asset_usage_events')
    .select('id')
    .eq('publishing_job_id', jobId)
    .eq('usage_stage', 'published')
    .limit(1);
  if (error) throw new Error(`hasPublishedEventsForJob: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Record scheduled usage when a publishing job enters an in-flight Graph state.
 */
export async function recordScheduledUsageForPublishingJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  if (await hasScheduledEventsForJob(supabase, jobId)) return;

  const { data: job, error: jErr } = await supabase
    .from('publishing_jobs')
    .select('id,post_candidate_id,source_asset_ids,publish_type')
    .eq('id', jobId)
    .maybeSingle();
  if (jErr) throw new Error(`recordScheduledUsageForPublishingJob: ${jErr.message}`);
  if (!job) return;

  const candidateId = job.post_candidate_id as string;
  const assetIds = Array.isArray(job.source_asset_ids)
    ? (job.source_asset_ids as string[]).filter(Boolean)
    : [];
  if (assetIds.length === 0) return;

  const { data: cand } = await supabase
    .from('post_candidates')
    .select('post_type')
    .eq('id', candidateId)
    .maybeSingle();
  const usageType = mapPostTypeToUsageType(
    (cand as { post_type?: string } | null)?.post_type ?? String(job.publish_type ?? ''),
  );

  for (const aid of assetIds) {
    await recordAssetUsageEvent(supabase, {
      contentAssetId: aid,
      postCandidateId: candidateId,
      publishingJobId: jobId,
      usageStage: 'scheduled',
      usageType,
      ledgerPostType: (cand as { post_type?: string } | null)?.post_type ?? null,
      usageRole: 'unknown',
      lockStrength: 'soft',
      notes: 'Publishing job scheduled / in-flight (Graph containers)',
    });
    await updateAssetUsageSummary(supabase, aid);
  }

  await refreshConflictsForAssets(supabase, assetIds);
}

/**
 * Record final published usage after publish (or at ready_to_publish when enabled).
 */
export async function applyPublishedAssetLocks(supabase: SupabaseClient, publishingJobId: string): Promise<void> {
  if (!APPLY_ASSET_LOCKS_AT_READY_TO_PUBLISH) {
    const { data: jobRow } = await supabase
      .from('publishing_jobs')
      .select('status')
      .eq('id', publishingJobId)
      .maybeSingle();
    if ((jobRow as { status?: string } | null)?.status !== 'published') return;
  }

  if (await hasPublishedEventsForJob(supabase, publishingJobId)) return;

  const { data: job, error: jErr } = await supabase
    .from('publishing_jobs')
    .select('id,post_candidate_id,source_asset_ids,publish_type,status')
    .eq('id', publishingJobId)
    .maybeSingle();
  if (jErr) throw new Error(`applyPublishedAssetLocks: ${jErr.message}`);
  if (!job) return;

  const { data: cand, error: cErr } = await supabase
    .from('post_candidates')
    .select('id,post_type')
    .eq('id', job.post_candidate_id as string)
    .maybeSingle();
  if (cErr) throw new Error(`applyPublishedAssetLocks(candidate): ${cErr.message}`);

  const rawType = (cand as { post_type?: string } | null)?.post_type?.trim();
  const pubType = String(job.publish_type ?? '').trim();
  const postType =
    rawType && rawType.length > 0
      ? rawType
      : pubType === 'image' || pubType === 'video'
        ? 'static_post'
        : pubType;
  const policy = computeAssetReusePolicy(postType);
  const usageType = mapPostTypeToUsageType(postType);
  const publishedAt = new Date().toISOString();
  const candidateId = job.post_candidate_id as string;

  const assetIds = Array.isArray(job.source_asset_ids)
    ? (job.source_asset_ids as string[]).filter(Boolean)
    : [];

  let reuseAfter: string | null = null;
  if (policy.lockStrength === 'soft' && policy.cooldownDays > 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + policy.cooldownDays);
    reuseAfter = d.toISOString();
  }

  for (const aid of assetIds) {
    await recordAssetUsageEvent(supabase, {
      contentAssetId: aid,
      postCandidateId: candidateId,
      publishingJobId,
      usageStage: 'published',
      usageType,
      ledgerPostType: postType,
      usageRole: 'primary',
      publishedAt,
      reuseAllowedAfter: reuseAfter,
      lockStrength: policy.lockStrength,
      notes: 'Final publication usage (operational: ready_to_publish boundary)',
    });
    await updateAssetUsageSummary(supabase, aid);
  }

  await refreshConflictsForAssets(supabase, assetIds);
}

const LEGACY_ASSET_LOCK_INVALIDATION = /operational lock|committed to another publish job|hard[- ]lock/i;

export function isLegacyAssetLockCandidateRow(row: {
  invalidated_at?: string | null;
  invalidation_reason?: string | null;
  has_asset_conflict?: boolean | null;
  asset_conflict_summary?: string | null;
}): boolean {
  if (row.invalidated_at && LEGACY_ASSET_LOCK_INVALIDATION.test(row.invalidation_reason ?? '')) {
    return true;
  }
  if (
    row.has_asset_conflict === true &&
    LEGACY_ASSET_LOCK_INVALIDATION.test(row.asset_conflict_summary ?? '')
  ) {
    return true;
  }
  return false;
}

/**
 * Clear historical hard-lock invalidations and refresh reuse warnings for one candidate.
 */
export async function releaseLegacyAssetLockInvalidationIfNeeded(
  supabase: SupabaseClient,
  candidateId: string,
  row: {
    invalidated_at?: string | null;
    invalidation_reason?: string | null;
    has_asset_conflict?: boolean | null;
    asset_conflict_summary?: string | null;
  },
): Promise<boolean> {
  if (!isLegacyAssetLockCandidateRow(row)) return false;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('post_candidates')
    .update({
      invalidated_at: null,
      invalidation_reason: null,
      updated_at: now,
    })
    .eq('id', candidateId);
  if (error) throw new Error(`releaseLegacyAssetLockInvalidationIfNeeded: ${error.message}`);

  await refreshCandidateAssetConflicts(supabase, candidateId);
  return true;
}

/** Recompute summaries for assets still marked hard_locked from the old enforcement model. */
export async function reconcileLegacyHardLockedAssetSummaries(
  supabase: SupabaseClient,
): Promise<{ repairedAssetIds: string[] }> {
  const pageSize = 1000;
  const assetIds: string[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('content_assets')
      .select('id')
      .or('hard_locked.eq.true,usage_status.eq.hard_locked')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`reconcileLegacyHardLockedAssetSummaries: ${error.message}`);

    const rows = page ?? [];
    for (const row of rows) {
      const id = (row as { id?: string | null }).id;
      if (id) assetIds.push(id);
    }
    if (rows.length < pageSize) break;
  }

  const repairedAssetIds: string[] = [];
  for (const assetId of assetIds) {
    await updateAssetUsageSummary(supabase, assetId);
    repairedAssetIds.push(assetId);
  }

  if (repairedAssetIds.length > 0) {
    await refreshConflictsForAssets(supabase, repairedAssetIds);
  }

  return { repairedAssetIds };
}

/** Bulk-heal candidates invalidated by the retired hard-lock model. */
export async function reconcileLegacyAssetLockCandidates(
  supabase: SupabaseClient,
): Promise<{ repairedCandidateIds: string[] }> {
  const pageSize = 500;
  const repairedCandidateIds: string[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('post_candidates')
      .select('id,invalidated_at,invalidation_reason,has_asset_conflict,asset_conflict_summary')
      .not('invalidated_at', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`reconcileLegacyAssetLockCandidates: ${error.message}`);

    const rows = page ?? [];
    for (const row of rows) {
      const id = (row as { id: string }).id;
      const healed = await releaseLegacyAssetLockInvalidationIfNeeded(supabase, id, row as {
        invalidated_at?: string | null;
        invalidation_reason?: string | null;
        has_asset_conflict?: boolean | null;
        asset_conflict_summary?: string | null;
      });
      if (healed) repairedCandidateIds.push(id);
    }
    if (rows.length < pageSize) break;
  }

  return { repairedCandidateIds };
}

/** Restore planner eligibility for assets auto-staled by the retired publish lock model. */
export async function reconcilePublishedAutoStaleEligibility(
  supabase: SupabaseClient,
): Promise<{ repairedAssetIds: string[] }> {
  const pageSize = 1000;
  const repairedAssetIds: string[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await supabase
      .from('content_assets')
      .select('id')
      .eq('candidate_eligibility', 'stale')
      .is('manually_marked_stale_at', null)
      .in('usage_status', [
        'published',
        'scheduled',
        'approved_pending',
        'hard_locked',
        'story_used_reusable_later',
      ])
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`reconcilePublishedAutoStaleEligibility: ${error.message}`);

    const rows = page ?? [];
    for (const row of rows) {
      const id = (row as { id?: string | null }).id;
      if (!id) continue;
      const { error: upErr } = await supabase
        .from('content_assets')
        .update({
          candidate_eligibility: 'eligible',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (upErr) throw new Error(`reconcilePublishedAutoStaleEligibility(update): ${upErr.message}`);
      repairedAssetIds.push(id);
    }
    if (rows.length < pageSize) break;
  }

  return { repairedAssetIds };
}

export async function refreshConflictsForAssets(supabase: SupabaseClient, assetIds: string[]): Promise<void> {
  const uniq = [...new Set(assetIds.filter(Boolean))];
  const candIds = new Set<string>();
  for (const aid of uniq) {
    const { data, error } = await supabase.from('post_candidates').select('id').overlaps('source_asset_ids', [aid]);
    if (error) throw new Error(`refreshConflictsForAssets: ${error.message}`);
    for (const row of data ?? []) candIds.add((row as { id: string }).id);
  }
  for (const cid of candIds) {
    await refreshCandidateAssetConflicts(supabase, cid);
  }
}

export async function refreshCandidateAssetConflicts(supabase: SupabaseClient, candidateId: string): Promise<void> {
  const candidate = await loadCandidate(supabase, candidateId);
  if (!candidate) return;

  const assetIds = getCandidateAssetIds(candidate);
  const warnings: string[] = [];
  const blocking: string[] = [];

  const assets = await loadAssets(supabase, assetIds);
  const now = Date.now();

  for (const aid of assetIds) {
    const row = assets.get(aid);
    if (!row) {
      blocking.push('Unknown source asset in registry.');
      continue;
    }
    if (row.hard_locked === true || (row.usage_status ?? '') === 'hard_locked') {
      warnings.push('Asset was used in a prior publish job.');
    }
    const ra = row.reuse_allowed_after;
    if (ra && Date.parse(ra) > now) {
      warnings.push(`Asset in story reuse cooldown until ${ra.slice(0, 10)}.`);
    }
    const st = (row.usage_status ?? '').trim();
    if (st === 'published') {
      warnings.push('Asset already published elsewhere.');
    } else if (st === 'scheduled') {
      warnings.push('Asset scheduled on another publish job.');
    } else if (st === 'approved_pending') {
      warnings.push('Asset approved in another candidate.');
    }

    if (await hasOtherApprovedReservation(supabase, aid, candidateId)) {
      warnings.push('Asset already approved in another candidate.');
    }
    if (await hasOtherScheduledUsage(supabase, aid, candidateId)) {
      warnings.push('Asset already scheduled for publication.');
    }
  }

  let freshness_warning: string | null = null;
  let is_fresh_story: boolean | null = null;
  if (isStoryPostType(candidate.post_type) && !isRecapLikeCandidate(candidate)) {
    const stale = assetIds.some((aid) => {
      const row = assets.get(aid);
      if (!row) return true;
      return !isFreshForStory(row);
    });
    is_fresh_story = !stale;
    if (stale) {
      freshness_warning =
        'Story uses stale assets. Convert to post/carousel/reel or mark as recap/throwback.';
    }
  } else {
    is_fresh_story = null;
    freshness_warning = null;
  }

  const warningSummary = [...new Set(warnings)].slice(0, 4).join(' ') || null;
  const hasBlocking = blocking.length > 0;
  const summary = hasBlocking
    ? [...new Set([...blocking, ...warnings])].slice(0, 4).join(' ')
    : warningSummary;

  const { error } = await supabase
    .from('post_candidates')
    .update({
      has_asset_conflict: hasBlocking,
      asset_conflict_summary: summary,
      freshness_warning,
      is_fresh_story,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId);
  if (error) throw new Error(`refreshCandidateAssetConflicts: ${error.message}`);
}

/**
 * When Graph refresh moves a job into `processing`, record scheduled usage once.
 */
export async function onPublishingJobStatusTransition(
  supabase: SupabaseClient,
  jobId: string,
  prevStatus: string,
  nextStatus: string,
): Promise<void> {
  const prev = (prevStatus ?? '').trim();
  const next = (nextStatus ?? '').trim();

  if (next === 'processing' && prev !== 'processing') {
    await recordScheduledUsageForPublishingJob(supabase, jobId);
  }

  if (next === 'ready_to_publish' && prev !== 'ready_to_publish' && APPLY_ASSET_LOCKS_AT_READY_TO_PUBLISH) {
    await applyPublishedAssetLocks(supabase, jobId);
  }

  if (next === 'published' && prev !== 'published') {
    await applyPublishedAssetLocks(supabase, jobId);
  }
}

/** Publishing job statuses that block permanent candidate deletion. */
export const BLOCKED_PUBLISHING_JOB_STATUSES_FOR_DELETE: ReadonlySet<string> = new Set([
  'ready_to_publish',
  'published',
]);

export type CanDeletePostCandidateParams = {
  candidateStatus: string;
  invalidatedAt?: string | null;
  publishingJobStatus?: string | null;
  productionJobStatus?: string | null;
};

export function canDeletePostCandidate(
  params: CanDeletePostCandidateParams,
): { ok: true } | { ok: false; code: string; message: string } {
  if (params.invalidatedAt?.trim()) {
    return { ok: false, code: 'invalidated', message: 'Candidate is invalidated.' };
  }
  const st = (params.candidateStatus ?? '').trim();
  if (st === 'ready_to_publish') {
    return {
      ok: false,
      code: 'ready_to_publish',
      message: 'Cannot delete a candidate that is ready to publish.',
    };
  }
  const pj = (params.publishingJobStatus ?? '').trim();
  if (pj && BLOCKED_PUBLISHING_JOB_STATUSES_FOR_DELETE.has(pj)) {
    return {
      ok: false,
      code: 'publishing_in_flight',
      message: `Cannot delete while publishing job is "${pj}".`,
    };
  }
  const prod = (params.productionJobStatus ?? '').trim();
  if (prod === 'rendering') {
    return {
      ok: false,
      code: 'production_rendering',
      message: 'Cannot delete while reel is rendering.',
    };
  }
  return { ok: true };
}

export type DeletePostCandidateResult = {
  drive_folder_deleted: boolean;
};

/**
 * Permanently remove a post candidate, related usage events, cascaded jobs, and optionally its Drive review folder.
 */
export async function deletePostCandidateCompletely(
  supabase: SupabaseClient,
  candidateId: string,
  drive?: drive_v3.Drive | null,
): Promise<DeletePostCandidateResult> {
  const { data: row, error: readErr } = await supabase
    .from('post_candidates')
    .select('id, status, review_drive_folder_id, publishing_job_id, invalidated_at')
    .eq('id', candidateId)
    .maybeSingle();
  if (readErr) throw new Error(`deletePostCandidateCompletely(read): ${readErr.message}`);
  if (!row) throw new AssetUsageError('not_found', 'Candidate not found.');

  const candidate = row as {
    id: string;
    status?: string | null;
    review_drive_folder_id?: string | null;
    publishing_job_id?: string | null;
    invalidated_at?: string | null;
  };

  let publishingJobStatus: string | null = null;
  const pjId = candidate.publishing_job_id?.trim();
  if (pjId) {
    const { data: pj, error: pjErr } = await supabase
      .from('publishing_jobs')
      .select('status')
      .eq('id', pjId)
      .maybeSingle();
    if (pjErr) throw new Error(`deletePostCandidateCompletely(publishing_job): ${pjErr.message}`);
    publishingJobStatus = ((pj as { status?: string } | null)?.status ?? '').trim() || null;
  }

  let productionJobStatus: string | null = null;
  const { data: prodRows, error: prodErr } = await supabase
    .from('production_jobs')
    .select('status')
    .eq('post_candidate_id', candidateId)
    .eq('production_type', 'reel')
    .limit(1);
  if (prodErr) throw new Error(`deletePostCandidateCompletely(production_jobs): ${prodErr.message}`);
  const prod = prodRows?.[0] as { status?: string } | undefined;
  productionJobStatus = (prod?.status ?? '').trim() || null;

  const guard = canDeletePostCandidate({
    candidateStatus: candidate.status ?? '',
    invalidatedAt: candidate.invalidated_at,
    publishingJobStatus,
    productionJobStatus,
  });
  if (!guard.ok) {
    throw new AssetUsageError(guard.code, guard.message);
  }

  const folderId = candidate.review_drive_folder_id?.trim() ?? '';

  const { data: usageRows, error: usageReadErr } = await supabase
    .from('asset_usage_events')
    .select('content_asset_id')
    .eq('post_candidate_id', candidateId);
  if (usageReadErr) {
    throw new Error(`deletePostCandidateCompletely(usage read): ${usageReadErr.message}`);
  }
  const assetIds = [
    ...new Set(
      (usageRows ?? [])
        .map((e: { content_asset_id?: string }) => e.content_asset_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  try {
    await releaseAssetsForCandidate(supabase, candidateId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`deletePostCandidateCompletely(release): ${msg}`);
  }

  const { error: usageDelErr } = await supabase
    .from('asset_usage_events')
    .delete()
    .eq('post_candidate_id', candidateId);
  if (usageDelErr) {
    throw new Error(`deletePostCandidateCompletely(usage delete): ${usageDelErr.message}`);
  }

  for (const aid of assetIds) {
    await updateAssetUsageSummary(supabase, aid);
  }
  if (assetIds.length > 0) {
    await refreshConflictsForAssets(supabase, assetIds);
  }

  const { error: delErr } = await supabase.from('post_candidates').delete().eq('id', candidateId);
  if (delErr) throw new Error(`deletePostCandidateCompletely(delete): ${delErr.message}`);

  let driveFolderDeleted = false;
  if (folderId && drive) {
    try {
      await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
      driveFolderDeleted = true;
    } catch (e) {
      console.warn('[deletePostCandidateCompletely] Drive folder delete failed', {
        candidateId,
        folderId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } else if (folderId && !drive) {
    console.warn('[deletePostCandidateCompletely] skipped Drive delete (no client)', { candidateId, folderId });
  } else {
    driveFolderDeleted = true;
  }

  return { drive_folder_deleted: driveFolderDeleted };
}
