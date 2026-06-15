import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendSeriesToSystemInstruction,
  formatSeriesBlockForPrompt,
  intersectEnabledPostTypesWithSeries,
  type SeriesRow,
} from './content-series.js';

function makeSeries(overrides: Partial<SeriesRow> = {}): SeriesRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'absurd-mission-life-takeover',
    name: 'Absurd mission',
    weight: 2,
    body_md: '## Core angle\nLife takeover.',
    status: 'active',
    description: '',
    vision: '',
    tone: '',
    discovery_patterns: [],
    examples: [],
    example_creators: [],
    target_platforms: ['instagram'],
    enabled_post_types: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('formatSeriesBlockForPrompt includes slug and normalized weight bias', () => {
  const block = formatSeriesBlockForPrompt([
    makeSeries({ weight: 2 }),
    makeSeries({
      id: '22222222-2222-2222-2222-222222222222',
      slug: 'carto-porn-funny',
      name: 'Carto porn',
      weight: 1,
      body_md: 'Map content.',
    }),
  ]);

  assert.match(block, /Active content series/);
  assert.match(block, /absurd-mission-life-takeover/);
  assert.match(block, /~67% bias/);
  assert.match(block, /carto-porn-funny/);
  assert.match(block, /~33% bias/);
});

test('appendSeriesToSystemInstruction appends series block to base instruction', () => {
  const result = appendSeriesToSystemInstruction('Base instruction.', [makeSeries()]);
  assert.match(result, /^Base instruction\./);
  assert.match(result, /Absurd mission/);
  assert.match(result, /Life takeover\./);
});

test('formatSeriesBlockForPrompt returns empty string when no series', () => {
  assert.equal(formatSeriesBlockForPrompt([]), '');
});

test('intersectEnabledPostTypesWithSeries keeps reels only for reels-only series', () => {
  const global = ['reel', 'carousel', 'static_post'];
  const reelsOnly = makeSeries({ enabled_post_types: ['reel'] });
  assert.deepEqual(intersectEnabledPostTypesWithSeries(global, reelsOnly), ['reel']);
});

test('intersectEnabledPostTypesWithSeries preserves global types when series allows all', () => {
  const global = ['reel', 'carousel'];
  const allTypes = makeSeries({ enabled_post_types: [] });
  assert.deepEqual(intersectEnabledPostTypesWithSeries(global, allTypes), global);
});

test('intersectEnabledPostTypesWithSeries returns empty when no overlap', () => {
  const global = ['carousel', 'static_post'];
  const reelsOnly = makeSeries({ enabled_post_types: ['reel'] });
  assert.deepEqual(intersectEnabledPostTypesWithSeries(global, reelsOnly), []);
});
