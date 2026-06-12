import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createRenderProgressPatch,
  estimateRemainingSeconds,
  formatDurationShort,
  formatElapsed,
  parseRenderProgress,
  progressForDownload,
  progressForEncode,
  progressForStage,
} from './reel-render-progress.js';

describe('progress bands', () => {
  test('download progress scales with asset index', () => {
    const first = progressForDownload(1, 2);
    const second = progressForDownload(2, 2);
    assert.ok((first.progress_pct ?? 0) < (second.progress_pct ?? 0));
    assert.equal(first.stage, 'download');
  });

  test('encode progress scales with segment index', () => {
    const first = progressForEncode(1, 3);
    const last = progressForEncode(3, 3);
    assert.ok((first.progress_pct ?? 0) < (last.progress_pct ?? 0));
    assert.equal(last.message, 'Encoding clip 3 of 3…');
  });

  test('fixed stages land in expected bands', () => {
    assert.equal(progressForStage('concat').progress_pct, 80);
    assert.equal(progressForStage('upload').progress_pct, 99);
    assert.equal(progressForStage('done').progress_pct, 100);
  });
});

describe('createRenderProgressPatch', () => {
  test('preserves started_at across updates', () => {
    const started = '2026-06-12T10:00:00.000Z';
    const a = createRenderProgressPatch({ stage: 'starting', progress_pct: 2, message: 'Go', started_at: started });
    const b = createRenderProgressPatch({ stage: 'download', progress_pct: 10, message: 'Dl' }, a);
    assert.equal(b.started_at, started);
    assert.equal(b.v, 1);
  });
});

describe('eta and formatting', () => {
  test('estimateRemainingSeconds returns null until enough progress', () => {
    const started = new Date(Date.now() - 30_000).toISOString();
    assert.equal(estimateRemainingSeconds(started, 3), null);
    const eta = estimateRemainingSeconds(started, 50);
    assert.ok(eta != null && eta > 0);
  });

  test('formatDurationShort', () => {
    assert.equal(formatDurationShort(45), '45s');
    assert.equal(formatDurationShort(125), '2m 5s');
  });

  test('formatElapsed', () => {
    const started = new Date(Date.now() - 65_000).toISOString();
    assert.equal(formatElapsed(started), '1m 5s');
  });
});

describe('parseRenderProgress', () => {
  test('parses structured log', () => {
    const started = new Date(Date.now() - 10_000).toISOString();
    const p = parseRenderProgress(
      {
        v: 1,
        stage: 'encode',
        progress_pct: 40,
        message: 'Encoding clip 1 of 2…',
        started_at: started,
        updated_at: new Date().toISOString(),
        detail: { current: 1, total: 2, unit: 'clip' },
      },
      'rendering',
    );
    assert.equal(p.stage, 'encode');
    assert.equal(p.progressPct, 40);
    assert.equal(p.message, 'Encoding clip 1 of 2…');
    assert.ok(p.elapsedSeconds != null && p.elapsedSeconds >= 9);
  });

  test('fallback for queued without log', () => {
    const p = parseRenderProgress(null, 'queued', new Date(Date.now() - 30_000).toISOString());
    assert.equal(p.stage, 'queued');
    assert.equal(p.progressPct, 0);
    assert.equal(p.isIndeterminate, true);
    assert.equal(p.showStuckHint, true);
  });
});
