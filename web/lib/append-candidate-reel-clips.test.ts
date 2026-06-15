import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ClipWithAsset } from '@fr94/content-clips';

import { appendReelClips, collectAttachedClipIds } from './append-candidate-reel-clips.js';

function mockClip(id: string, assetId: string, driveFileId: string): ClipWithAsset {
  return {
    id,
    content_asset_id: assetId,
    seq: 0,
    start_sec: 1,
    end_sec: 4,
    duration_sec: 3,
    visual_summary: 'test clip',
    transcript_excerpt: '',
    supported_reel_formats: [],
    fitting_series_slugs: [],
    pov_concepts: [],
    hooks: [],
    emotional_tags: [],
    tension_tags: [],
    visual_tags: [],
    discovery_tags: [],
    could_be_used_for: [],
    thumbnail_path: null,
    status: 'ready',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    asset: {
      id: assetId,
      drive_file_id: driveFileId,
      current_filename: 'clip.mov',
      final_filename: null,
      duration_seconds: 30,
      usage_status: null,
      quality_score: null,
      processed_at: '2026-01-01T00:00:00.000Z',
      status: 'processed',
      candidate_eligibility: 'eligible',
    },
  };
}

describe('appendReelClips', () => {
  test('appends clips to clips-v1 pool', () => {
    const clipA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const assetA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const clipB = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const assetB = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

    const result = appendReelClips({
      reel_instructions: {
        version: 'clips-v1',
        clips: [
          {
            clip_id: clipA,
            asset_id: assetA,
            drive_file_id: 'drive-1',
            start_sec: 1,
            end_sec: 4,
            why: 'opening',
          },
        ],
      },
      source_asset_ids: [assetA],
      source_drive_file_ids: ['drive-1'],
      newClips: [mockClip(clipB, assetB, 'drive-2')],
    });

    assert.ok(!('error' in result));
    if ('error' in result) return;

    assert.equal(result.selected_clip_ids.length, 2);
    assert.deepEqual(result.source_asset_ids.sort(), [assetA, assetB].sort());
    const spec = result.reel_instructions as { clips: Array<{ clip_id: string }> };
    assert.equal(spec.clips.length, 2);
    assert.equal(spec.clips[1]?.clip_id, clipB);
  });

  test('rejects duplicate clip', () => {
    const clipA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const assetA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const result = appendReelClips({
      reel_instructions: {
        version: 'clips-v1',
        clips: [
          {
            clip_id: clipA,
            asset_id: assetA,
            drive_file_id: 'drive-1',
            start_sec: 1,
            end_sec: 4,
          },
        ],
      },
      source_asset_ids: [assetA],
      source_drive_file_ids: ['drive-1'],
      newClips: [mockClip(clipA, assetA, 'drive-1')],
    });

    assert.ok('error' in result);
    assert.match(result.error, /already attached/i);
  });
});

describe('collectAttachedClipIds', () => {
  test('merges ids from spec and selected_clip_ids column', () => {
    const ids = collectAttachedClipIds(
      {
        version: 'clips-v1',
        clips: [{ clip_id: 'clip-1', asset_id: 'asset-1', drive_file_id: 'd1', start_sec: 0, end_sec: 1 }],
      },
      ['clip-2'],
    );
    assert.deepEqual(ids, ['clip-1', 'clip-2']);
  });
});
