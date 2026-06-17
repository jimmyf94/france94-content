import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assetDisplayTitle,
  isVideoAsset,
  normalizeHashtags,
} from './post-as-reel-utils.ts';

test('isVideoAsset accepts mime and media_type', () => {
  assert.equal(isVideoAsset({ mime_type: 'video/mp4', media_type: null }), true);
  assert.equal(isVideoAsset({ mime_type: null, media_type: 'video' }), true);
  assert.equal(isVideoAsset({ mime_type: 'image/jpeg', media_type: 'image' }), false);
});

test('normalizeHashtags strips hash and blanks', () => {
  assert.deepEqual(normalizeHashtags(['#run', ' trail ', '', '#france94']), ['run', 'trail', 'france94']);
  assert.deepEqual(normalizeHashtags(null), []);
});

test('assetDisplayTitle prefers final filename', () => {
  assert.equal(
    assetDisplayTitle({
      final_filename: 'final.mov',
      current_filename: 'current.mov',
      original_filename: 'orig.mov',
    }),
    'final.mov',
  );
  assert.equal(assetDisplayTitle({}), 'Library reel');
});
