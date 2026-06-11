import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAssetLookupMaps,
  parsePlannerResponse,
  resolveSourceAssetIds,
  validatePostCandidateOutput,
  type AssetSummaryForLLM,
} from './generate-post-candidates.js';

const ASSET_UUID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';
const ASSET_UUID_2 = 'b2c3d4e5-f6a7-4890-b123-456789abcdef0';
const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWx';
const DRIVE_ID_2 = '2BcDeFgHiJkLmNoPqRsTuVwXy';

function makeSummary(overrides: Partial<AssetSummaryForLLM> = {}): AssetSummaryForLLM {
  return {
    id: ASSET_UUID,
    drive_file_id: DRIVE_ID,
    current_filename: 'clip.mov',
    final_filename: null,
    media_type: 'video',
    activity: 'run',
    content_lane: 'reel',
    suggested_title: 'Hill run',
    visual_summary: 'Runner on a hill',
    semantic_summary: null,
    transcript_excerpt: null,
    audio_transcript_excerpt: null,
    tags: null,
    quality_score: 8,
    mission_score: 7,
    human_score: 8,
    sponsor_safety_score: 9,
    location_guess: 'Paris',
    postal_code: '75001',
    duration_seconds: 30,
    drive_review_link: null,
    is_fresh_for_story: true,
    usage_status: 'unused',
    ...overrides,
  };
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    post_type: 'reel',
    title: 'Test reel',
    hook: 'Hook',
    concept_summary: 'Summary',
    rationale: 'Because',
    caption_fr: 'Caption FR',
    caption_en: '',
    hashtags: ['france94'],
    source_asset_ids: [ASSET_UUID],
    source_drive_file_ids: [DRIVE_ID],
    priority_score: 7,
    mission_score: 7,
    human_score: 7,
    sponsor_safety_score: 8,
    effort_score: 6,
    ...overrides,
  };
}

test('validatePostCandidateOutput accepts valid asset UUID', () => {
  const summaries = [makeSummary()];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const result = validatePostCandidateOutput(
    makeCandidate(),
    assetById,
    new Set(['reel']),
    assetByDriveId,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.source_asset_ids, [ASSET_UUID]);
    assert.deepEqual(result.data.source_drive_file_ids, [DRIVE_ID]);
  }
});

test('validatePostCandidateOutput repairs drive file id in source_asset_ids', () => {
  const summaries = [makeSummary()];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const result = validatePostCandidateOutput(
    makeCandidate({ source_asset_ids: [DRIVE_ID] }),
    assetById,
    new Set(['reel']),
    assetByDriveId,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.source_asset_ids, [ASSET_UUID]);
  }
});

test('validatePostCandidateOutput rejects random non-UUID string', () => {
  const summaries = [makeSummary()];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const result = validatePostCandidateOutput(
    makeCandidate({
      source_asset_ids: ['not-a-real-id'],
      source_drive_file_ids: [],
    }),
    assetById,
    new Set(['reel']),
    assetByDriveId,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /unknown asset id/);
  }
});

test('validatePostCandidateOutput repairs mixed UUID and drive id', () => {
  const summaries = [
    makeSummary(),
    makeSummary({ id: ASSET_UUID_2, drive_file_id: DRIVE_ID_2 }),
  ];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const result = validatePostCandidateOutput(
    makeCandidate({
      source_asset_ids: [ASSET_UUID, DRIVE_ID_2],
      source_drive_file_ids: [DRIVE_ID, DRIVE_ID_2],
    }),
    assetById,
    new Set(['reel']),
    assetByDriveId,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.source_asset_ids, [ASSET_UUID, ASSET_UUID_2]);
  }
});

test('validatePostCandidateOutput rejects empty source_asset_ids', () => {
  const summaries = [makeSummary()];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const result = validatePostCandidateOutput(
    makeCandidate({ source_asset_ids: [] }),
    assetById,
    new Set(['reel']),
    assetByDriveId,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /source_asset_ids empty/);
  }
});

test('resolveSourceAssetIds deduplicates while preserving order', () => {
  const summaries = [makeSummary()];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const resolved = resolveSourceAssetIds(
    [ASSET_UUID, DRIVE_ID],
    [DRIVE_ID, DRIVE_ID],
    assetById,
    assetByDriveId,
  );
  assert.ok(!('error' in resolved));
  if (!('error' in resolved)) {
    assert.deepEqual(resolved.ids, [ASSET_UUID]);
    assert.deepEqual(resolved.driveIds, [DRIVE_ID]);
  }
});

test('validatePostCandidateOutput accepts selected_series metadata', () => {
  const summaries = [makeSummary()];
  const { assetById, assetByDriveId } = buildAssetLookupMaps(summaries);
  const result = validatePostCandidateOutput(
    makeCandidate({
      selected_series: 'absurd-mission-life-takeover',
      series_reasoning: 'Assets show life takeover angle.',
    }),
    assetById,
    new Set(['reel']),
    assetByDriveId,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.selected_series, 'absurd-mission-life-takeover');
  }
});

test('parsePlannerResponse skips bad candidate and keeps valid ones', () => {
  const summaries = [makeSummary()];
  const parsed = parsePlannerResponse(
    {
      candidates: [
        makeCandidate(),
        makeCandidate({
          source_asset_ids: ['bogus-id'],
          source_drive_file_ids: [],
          title: 'Bad candidate',
        }),
      ],
    },
    summaries,
    ['reel'],
  );
  assert.equal(parsed.rawReturnedCount, 2);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.validationErrors.length, 1);
  assert.match(parsed.validationErrors[0], /candidate\[1\]/);
});
