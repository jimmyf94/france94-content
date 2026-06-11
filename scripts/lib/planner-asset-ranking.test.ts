import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rankAndCapPlannerAssets,
  scoreAssetForPlanner,
  type PlannerAssetSummary,
} from './planner-asset-ranking.js';

function makeSummary(overrides: Partial<PlannerAssetSummary> = {}): PlannerAssetSummary {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    suggested_title: 'Run',
    visual_summary: 'Hill run',
    semantic_summary: null,
    quality_score: 7,
    mission_score: 7,
    human_score: 7,
    is_fresh_for_story: false,
    usage_status: 'unused',
    ...overrides,
  };
}

test('scoreAssetForPlanner excludes blocked usage statuses', () => {
  const ctx = { committedAssetIds: new Set<string>(), rejectedAssetIds: new Set<string>() };
  assert.equal(
    scoreAssetForPlanner(makeSummary({ usage_status: 'published' }), ctx),
    Number.NEGATIVE_INFINITY,
  );
});

test('scoreAssetForPlanner prefers fresh unused assets over committed ones', () => {
  const id = '22222222-2222-2222-2222-222222222222';
  const ctx = {
    committedAssetIds: new Set([id]),
    rejectedAssetIds: new Set<string>(),
  };
  const freshUnused = scoreAssetForPlanner(
    makeSummary({ is_fresh_for_story: true, usage_status: 'unused' }),
    ctx,
  );
  const committed = scoreAssetForPlanner(
    makeSummary({ id, is_fresh_for_story: true, usage_status: 'unused' }),
    ctx,
  );
  assert.ok(freshUnused > committed);
});

test('rankAndCapPlannerAssets caps to maxAssets', () => {
  const summaries = [
    makeSummary({ id: 'a', quality_score: 9 }),
    makeSummary({ id: 'b', quality_score: 8 }),
    makeSummary({ id: 'c', quality_score: 7 }),
    makeSummary({ id: 'd', quality_score: 6 }),
  ];
  const { selected, eligibleCount, totalPool } = rankAndCapPlannerAssets(
    summaries,
    { committedAssetIds: new Set(), rejectedAssetIds: new Set() },
    2,
  );
  assert.equal(totalPool, 4);
  assert.equal(eligibleCount, 4);
  assert.equal(selected.length, 2);
  assert.equal(selected[0]?.id, 'a');
  assert.equal(selected[1]?.id, 'b');
});
