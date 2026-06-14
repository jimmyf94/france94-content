/** Minimal asset shape for deterministic planner pre-ranking. */
export type PlannerAssetSummary = {
  id: string;
  usage_status: string;
  is_fresh_for_story: boolean;
  quality_score: number | string | null;
  mission_score: number | string | null;
  human_score: number | string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  suggested_title: string | null;
  candidate_eligibility?: string | null;
};

/** Assets the planner must not use (matches generate_candidate.md rules). */
const BLOCKED_USAGE_STATUSES = new Set([
  'published',
  'hard_locked',
  'approved_pending',
]);

export type PlannerAssetRankContext = {
  committedAssetIds: Set<string>;
  rejectedAssetIds: Set<string>;
};

function numericScore(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function scoreAssetForPlanner(
  summary: PlannerAssetSummary,
  ctx: PlannerAssetRankContext,
): number {
  if (BLOCKED_USAGE_STATUSES.has(summary.usage_status)) return Number.NEGATIVE_INFINITY;

  let score = 0;
  score += numericScore(summary.quality_score) * 2;
  score += numericScore(summary.mission_score) * 1.5;
  score += numericScore(summary.human_score) * 1.5;

  if (summary.is_fresh_for_story) score += 15;
  if (summary.usage_status === 'unused') score += 10;
  else if (summary.usage_status === 'story_used_reusable_later') score += 6;
  else if (summary.usage_status === 'suggested') score += 3;

  if (summary.visual_summary?.trim() || summary.semantic_summary?.trim()) score += 2;
  if (summary.suggested_title?.trim()) score += 1;

  if ((summary.candidate_eligibility ?? '').trim() === 'needs_review') score -= 8;
  if (ctx.committedAssetIds.has(summary.id)) score -= 20;
  if (ctx.rejectedAssetIds.has(summary.id)) score -= 5;

  return score;
}

export function rankAndCapPlannerAssets<T extends PlannerAssetSummary>(
  summaries: T[],
  ctx: PlannerAssetRankContext,
  maxAssets: number,
): { selected: T[]; eligibleCount: number; totalPool: number } {
  const ranked = summaries
    .map((s) => ({ summary: s, score: scoreAssetForPlanner(s, ctx) }))
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.summary.is_fresh_for_story !== b.summary.is_fresh_for_story) {
        return a.summary.is_fresh_for_story ? -1 : 1;
      }
      return a.summary.id.localeCompare(b.summary.id);
    });

  const cap = Math.max(1, maxAssets);
  return {
    selected: ranked.slice(0, cap).map((row) => row.summary),
    eligibleCount: ranked.length,
    totalPool: summaries.length,
  };
}
