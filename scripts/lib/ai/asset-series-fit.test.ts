import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampBundleForType,
  clampTopTargets,
  parseGenerationTargetsResponse,
  selectTopTargets,
  type FitScoringAsset,
  type GenerationTarget,
} from './asset-series-fit.js';
import type { SeriesRow } from '../content-series.js';

const ASSET_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ASSET_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ASSET_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ASSET_D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function makeAsset(overrides: Partial<FitScoringAsset> = {}): FitScoringAsset {
  return {
    id: ASSET_A,
    activity: 'run',
    content_lane: 'reel',
    tags: null,
    suggested_title: 'Test',
    visual_summary: 'Summary',
    semantic_summary: null,
    media_type: 'image',
    is_fresh_for_story: false,
    ...overrides,
  };
}

function makeSeries(slug: string, weight: number): SeriesRow {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    weight,
    body_md: `Brief for ${slug}`,
    status: 'active',
    description: '',
    vision: '',
    tone: '',
    discovery_patterns: [],
    examples: [],
    example_creators: [],
    target_platforms: ['instagram'],
    enabled_post_types: [],
    created_at: '',
    updated_at: '',
  };
}

function makeTarget(overrides: Partial<GenerationTarget> = {}): GenerationTarget {
  return {
    seriesSlug: 'carto-porn',
    postTypeHint: 'carousel',
    assetIds: [ASSET_A, ASSET_B, ASSET_C],
    fitScore: 8,
    reason: 'test',
    ...overrides,
  };
}

const defaultBundleOpts = { carouselMax: 6, storyMax: 5 };

test('clampTopTargets clamps to 2–4', () => {
  assert.equal(clampTopTargets(1), 2);
  assert.equal(clampTopTargets(2), 2);
  assert.equal(clampTopTargets(3), 3);
  assert.equal(clampTopTargets(4), 4);
  assert.equal(clampTopTargets(10), 4);
  assert.equal(clampTopTargets(NaN), 3);
});

test('parseGenerationTargetsResponse clamps scores and drops unknown ids/types', () => {
  const validAssets = new Set([ASSET_A, ASSET_B]);
  const validSeries = new Set(['carto-porn', 'data-brain']);
  const enabled = new Set(['carousel', 'reel']);

  const parsed = parseGenerationTargetsResponse(
    {
      targets: [
        {
          series_slug: 'carto-porn',
          post_type_hint: 'carousel',
          asset_ids: [ASSET_A, ASSET_B, 'unknown'],
          fit_score: 12,
          reason: 'map',
        },
        {
          series_slug: 'unknown-series',
          post_type_hint: 'carousel',
          asset_ids: [ASSET_A],
          fit_score: 8,
          reason: 'skip',
        },
        {
          series_slug: 'data-brain',
          post_type_hint: 'reel',
          asset_ids: [ASSET_B],
          fit_score: -1,
          reason: 'talking head',
        },
      ],
    },
    validAssets,
    validSeries,
    enabled,
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.fitScore, 10);
  assert.equal(parsed[1]?.fitScore, 0);
  assert.deepEqual(parsed[0]?.assetIds, [ASSET_A, ASSET_B]);
});

test('clampBundleForType carousel requires >=2 image/video and caps max', () => {
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A, media_type: 'image' })],
    [ASSET_B, makeAsset({ id: ASSET_B, media_type: 'video' })],
    [ASSET_C, makeAsset({ id: ASSET_C, media_type: 'image' })],
    [ASSET_D, makeAsset({ id: ASSET_D, media_type: 'image' })],
  ]);

  assert.deepEqual(
    clampBundleForType('carousel', [ASSET_A], assetsById, defaultBundleOpts),
    [],
  );
  assert.deepEqual(
    clampBundleForType('carousel', [ASSET_A, ASSET_B], assetsById, defaultBundleOpts),
    [ASSET_A, ASSET_B],
  );
  assert.deepEqual(
    clampBundleForType(
      'carousel',
      [ASSET_A, ASSET_B, ASSET_C, ASSET_D],
      assetsById,
      { carouselMax: 3, storyMax: 5 },
    ).length,
    3,
  );
});

test('clampBundleForType story_sequence requires fresh assets', () => {
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A, is_fresh_for_story: true })],
    [ASSET_B, makeAsset({ id: ASSET_B, is_fresh_for_story: false })],
    [ASSET_C, makeAsset({ id: ASSET_C, is_fresh_for_story: true })],
  ]);

  assert.deepEqual(
    clampBundleForType('story_sequence', [ASSET_A, ASSET_B], assetsById, defaultBundleOpts),
    [],
  );
  assert.deepEqual(
    clampBundleForType('story_sequence', [ASSET_A, ASSET_C], assetsById, defaultBundleOpts),
    [ASSET_A, ASSET_C],
  );
});

test('clampBundleForType reel prefers video asset', () => {
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A, media_type: 'image' })],
    [ASSET_B, makeAsset({ id: ASSET_B, media_type: 'video' })],
  ]);

  assert.deepEqual(
    clampBundleForType('reel', [ASSET_A, ASSET_B], assetsById, defaultBundleOpts),
    [ASSET_B],
  );
});

test('selectTopTargets orders by fit score desc', () => {
  const series = [makeSeries('carto-porn', 1), makeSeries('data-brain', 5)];
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A })],
    [ASSET_B, makeAsset({ id: ASSET_B })],
    [ASSET_C, makeAsset({ id: ASSET_C })],
  ]);
  const targets = [
    makeTarget({ assetIds: [ASSET_A, ASSET_B, ASSET_C], fitScore: 9 }),
    makeTarget({
      seriesSlug: 'data-brain',
      postTypeHint: 'reel',
      assetIds: [ASSET_B],
      fitScore: 7,
    }),
    makeTarget({ assetIds: [ASSET_C, ASSET_A, ASSET_B], fitScore: 5 }),
  ];

  const selected = selectTopTargets(targets, series, assetsById, 2, defaultBundleOpts);
  assert.equal(selected.length, 2);
  assert.equal(selected[0]?.fitScore, 9);
  assert.equal(selected[0]?.assetIds[0], ASSET_A);
  assert.equal(selected[1]?.assetIds[0], ASSET_B);
});

test('selectTopTargets uses series weight as tie-breaker', () => {
  const series = [makeSeries('low-weight', 1), makeSeries('high-weight', 10)];
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A })],
    [ASSET_B, makeAsset({ id: ASSET_B })],
    [ASSET_C, makeAsset({ id: ASSET_C })],
  ]);
  const targets = [
    makeTarget({ seriesSlug: 'low-weight', assetIds: [ASSET_A, ASSET_B, ASSET_C], fitScore: 8 }),
    makeTarget({
      seriesSlug: 'high-weight',
      postTypeHint: 'reel',
      assetIds: [ASSET_B],
      fitScore: 8,
    }),
  ];

  const selected = selectTopTargets(targets, series, assetsById, 2, defaultBundleOpts);
  assert.equal(selected.length, 2);
  assert.equal(selected[0]?.seriesSlug, 'high-weight');
  assert.equal(selected[1]?.seriesSlug, 'low-weight');
});

test('selectTopTargets prefers distinct primary assets', () => {
  const series = [makeSeries('carto-porn', 5), makeSeries('data-brain', 3)];
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A })],
    [ASSET_B, makeAsset({ id: ASSET_B })],
    [ASSET_C, makeAsset({ id: ASSET_C })],
  ]);
  const targets = [
    makeTarget({ assetIds: [ASSET_A, ASSET_B, ASSET_C], fitScore: 9 }),
    makeTarget({
      seriesSlug: 'data-brain',
      postTypeHint: 'reel',
      assetIds: [ASSET_A],
      fitScore: 8,
    }),
    makeTarget({
      seriesSlug: 'data-brain',
      postTypeHint: 'reel',
      assetIds: [ASSET_B],
      fitScore: 7,
    }),
  ];

  const selected = selectTopTargets(targets, series, assetsById, 2, defaultBundleOpts);
  assert.equal(selected.length, 2);
  const primaries = selected.map((t) => t.assetIds[0]);
  assert.deepEqual(new Set(primaries).size, 2);
  assert.ok(primaries.includes(ASSET_A));
  assert.ok(primaries.includes(ASSET_B));
});

test('selectTopTargets respects cap clamped to 2–4', () => {
  const series = [makeSeries('s1', 1), makeSeries('s2', 1)];
  const assetsById = new Map<string, FitScoringAsset>([
    [ASSET_A, makeAsset({ id: ASSET_A })],
    [ASSET_B, makeAsset({ id: ASSET_B })],
    [ASSET_C, makeAsset({ id: ASSET_C })],
  ]);
  const targets = [
    makeTarget({ seriesSlug: 's1', assetIds: [ASSET_A, ASSET_B, ASSET_C], fitScore: 9 }),
    makeTarget({ seriesSlug: 's2', postTypeHint: 'reel', assetIds: [ASSET_B], fitScore: 8 }),
    makeTarget({ seriesSlug: 's1', assetIds: [ASSET_C, ASSET_A, ASSET_B], fitScore: 7 }),
  ];

  assert.equal(selectTopTargets(targets, series, assetsById, 1, defaultBundleOpts).length, 2);
  assert.equal(selectTopTargets(targets, series, assetsById, 3, defaultBundleOpts).length, 3);
  assert.equal(selectTopTargets(targets, series, assetsById, 99, defaultBundleOpts).length, 3);
});
