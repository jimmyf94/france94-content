import assert from 'node:assert/strict';
import test from 'node:test';

import type { ClipWithAsset } from './content-clips.js';
import type { SeriesRow } from './content-series.js';
import {
  buildVariantBaseFromCandidate,
  parseReelSpecification,
  pickAlternateSeriesSlug,
  scoreSeriesForReels,
  selectClipPoolForSeries,
  validateReelClipSelection,
} from './reel-assembly.js';

function makeClip(overrides: Partial<ClipWithAsset> = {}): ClipWithAsset {
  return {
    id: 'clip-1',
    content_asset_id: 'asset-1',
    seq: 0,
    start_sec: 0,
    end_sec: 10,
    duration_sec: 10,
    visual_summary: 'Running at sunrise',
    transcript_excerpt: '',
    supported_reel_formats: ['pov'],
    fitting_series_slugs: ['pov-series'],
    pov_concepts: ['pov : ta vie est devenue un plan'],
    hooks: ['hook 1'],
    emotional_tags: ['solitude'],
    tension_tags: [],
    visual_tags: ['sunrise'],
    discovery_tags: [],
    could_be_used_for: [],
    thumbnail_path: null,
    status: 'ready',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    asset: {
      id: 'asset-1',
      drive_file_id: 'drive-1',
      current_filename: 'a.mov',
      final_filename: null,
      duration_seconds: 30,
      usage_status: 'unused',
      quality_score: 7,
      processed_at: '2026-06-01T00:00:00Z',
    },
    ...overrides,
  };
}

function makeSeries(overrides: Partial<SeriesRow> = {}): SeriesRow {
  return {
    id: 'series-1',
    slug: 'pov-series',
    name: 'POV',
    weight: 2,
    body_md: '',
    status: 'active',
    description: '',
    vision: '',
    tone: '',
    discovery_patterns: [],
    examples: [],
    example_creators: [],
    target_platforms: ['instagram'],
    enabled_post_types: ['reel'],
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

test('scoreSeriesForReels filters series without reels enabled', () => {
  const clips = [makeClip()];
  const scored = scoreSeriesForReels(
    [
      makeSeries(),
      makeSeries({ id: 's2', slug: 'carousel-only', enabled_post_types: ['carousel'] }),
    ],
    clips,
  );
  assert.equal(scored.length, 1);
  assert.equal(scored[0]?.series.slug, 'pov-series');
});

test('scoreSeriesForReels orders by weight x matching clips', () => {
  const clips = [
    makeClip({ id: 'c1', fitting_series_slugs: ['a'] }),
    makeClip({ id: 'c2', fitting_series_slugs: ['a'] }),
    makeClip({ id: 'c3', fitting_series_slugs: ['b'] }),
  ];
  const scored = scoreSeriesForReels(
    [
      makeSeries({ id: 'sa', slug: 'a', weight: 1 }),
      makeSeries({ id: 'sb', slug: 'b', weight: 5 }),
    ],
    clips,
  );
  // a: 1*2=2, b: 5*1=5
  assert.equal(scored[0]?.series.slug, 'b');
  assert.equal(scored[1]?.series.slug, 'a');
});

test('scoreSeriesForReels falls back to weight when no tags match', () => {
  const clips = [makeClip({ fitting_series_slugs: [] })];
  const scored = scoreSeriesForReels(
    [makeSeries({ slug: 'x', weight: 1 }), makeSeries({ id: 's2', slug: 'y', weight: 3 })],
    clips,
  );
  assert.equal(scored[0]?.series.slug, 'y');
  assert.equal(scored.length, 2);
});

test('selectClipPoolForSeries puts matching clips first', () => {
  const clips = [
    makeClip({ id: 'other', fitting_series_slugs: ['other-series'] }),
    makeClip({ id: 'match', fitting_series_slugs: ['pov-series'] }),
  ];
  const pool = selectClipPoolForSeries(clips, 'pov-series');
  assert.equal(pool[0]?.id, 'match');
  assert.equal(pool.length, 2);
});

test('validateReelClipSelection clamps trims to clip bounds and accepts 12-18s', () => {
  const pool = new Map([
    ['c1', makeClip({ id: 'c1', start_sec: 0, end_sec: 10 })],
    ['c2', makeClip({ id: 'c2', start_sec: 20, end_sec: 30, content_asset_id: 'asset-2' })],
  ]);
  const res = validateReelClipSelection(
    [
      { clip_id: 'c1', start_sec: -2, end_sec: 8 },
      { clip_id: 'c2', start_sec: 20, end_sec: 26 },
    ],
    pool,
  );
  assert.ok(!('error' in res));
  if ('error' in res) return;
  assert.equal(res.clips[0]?.start_sec, 0);
  assert.equal(res.totalSec, 14);
});

test('validateReelClipSelection trims overage on the last clip', () => {
  const pool = new Map([
    ['c1', makeClip({ id: 'c1', start_sec: 0, end_sec: 12 })],
    ['c2', makeClip({ id: 'c2', start_sec: 0, end_sec: 12 })],
  ]);
  const res = validateReelClipSelection(
    [
      { clip_id: 'c1', start_sec: 0, end_sec: 12 },
      { clip_id: 'c2', start_sec: 0, end_sec: 12 },
    ],
    pool,
  );
  assert.ok(!('error' in res));
  if ('error' in res) return;
  assert.equal(res.totalSec, 18);
});

test('validateReelClipSelection rejects unknown clips and too-short selections', () => {
  const pool = new Map([['c1', makeClip({ id: 'c1', start_sec: 0, end_sec: 10 })]]);
  assert.ok('error' in validateReelClipSelection([{ clip_id: 'nope', start_sec: 0, end_sec: 5 }], pool));
  assert.ok('error' in validateReelClipSelection([{ clip_id: 'c1', start_sec: 0, end_sec: 4 }], pool));
  assert.ok('error' in validateReelClipSelection([], pool));
});

test('parseReelSpecification reads clips-v1 instructions', () => {
  const spec = parseReelSpecification({
    version: 'clips-v1',
    clips: [
      {
        clip_id: 'c1',
        asset_id: 'a1',
        drive_file_id: 'd1',
        start_sec: 1,
        end_sec: 8,
      },
    ],
    overlay_lines: ['pov : test'],
    total_duration_sec: 7,
  });
  assert.ok(spec);
  assert.equal(spec!.clips.length, 1);
  assert.equal(spec!.overlay_lines[0], 'pov : test');
});

test('buildVariantBaseFromCandidate maps stored reel to variant base', () => {
  const base = buildVariantBaseFromCandidate({
    id: 'cand-1',
    hook: 'pov : old',
    selected_series: 'pov-series',
    reel_instructions: {
      version: 'clips-v1',
      clips: [{ clip_id: 'c1', asset_id: 'a1', drive_file_id: 'd1', start_sec: 0, end_sec: 6 }],
      overlay_lines: ['pov : old'],
    },
  });
  assert.ok(base);
  assert.equal(base!.candidate_id, 'cand-1');
  assert.equal(base!.clips.length, 1);
});

test('pickAlternateSeriesSlug returns a different series', () => {
  const series = [
    makeSeries({ slug: 'pov-series', weight: 10 }),
    makeSeries({ slug: 'carto', name: 'Carto', weight: 8 }),
  ];
  const clips = [
    makeClip({ fitting_series_slugs: ['pov-series', 'carto'] }),
    makeClip({ id: 'clip-2', fitting_series_slugs: ['carto'] }),
  ];
  assert.equal(pickAlternateSeriesSlug(series, clips, 'pov-series'), 'carto');
});
