/**
 * Phase keys mirror `prompts/context/mission.md`. Boundaries are end-of-day UTC.
 */
export type Fr94ProjectPhase =
  | 'foundation_public_build'
  | 'pre_challenge_build'
  | 'challenge_live'
  | 'aftermath_legacy';

export function resolveFr94Phase(date: Date = new Date()): Fr94ProjectPhase {
  const t = date.getTime();
  const preChallengeStart = Date.UTC(2027, 0, 1);
  const challengeStart = Date.UTC(2027, 3, 12);
  const aftermathStart = Date.UTC(2027, 6, 15);
  if (t < preChallengeStart) return 'foundation_public_build';
  if (t < challengeStart) return 'pre_challenge_build';
  if (t < aftermathStart) return 'challenge_live';
  return 'aftermath_legacy';
}

export function buildPostPlannerDynamicText(params: {
  summaries: unknown[];
  dailyTarget: number;
  batchDays: number;
  enabledPostTypes: string[];
  currentDate?: string;
  currentPhase?: Fr94ProjectPhase;
  assumeColdAudience?: boolean;
  avoidRecentRejections?: unknown[];
  committedRecentPosts?: unknown[];
}): string {
  const now = new Date();
  const currentDate = params.currentDate ?? now.toISOString().slice(0, 10);
  const currentPhase = params.currentPhase ?? resolveFr94Phase(now);
  const dynamicPayload: Record<string, unknown> = {
    constraints: {
      batch_days: params.batchDays,
      daily_target: params.dailyTarget,
      asset_count: params.summaries.length,
      enabled_post_types: params.enabledPostTypes,
      current_date: currentDate,
      current_phase: currentPhase,
      assume_cold_audience: params.assumeColdAudience ?? false,
    },
    assets: params.summaries,
  };
  if (params.avoidRecentRejections && params.avoidRecentRejections.length > 0) {
    dynamicPayload.avoid_recent_rejections = params.avoidRecentRejections;
  }
  if (params.committedRecentPosts && params.committedRecentPosts.length > 0) {
    dynamicPayload.committed_recent_posts = params.committedRecentPosts;
  }
  return `Dynamic payload (JSON):\n${JSON.stringify(dynamicPayload, null, 2)}`;
}
