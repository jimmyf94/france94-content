import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  moveCarouselAssetId,
  orderedCarouselAssetIds,
  reorderCandidateCarouselSlides,
} from './reorder-candidate-carousel-slides.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('reorderCandidateCarouselSlides', () => {
  test('reorders slides and preserves headline/body', () => {
    const result = reorderCandidateCarouselSlides({
      source_asset_ids: [A, B, C],
      carousel_slides: [
        { slide: 1, asset_id: A, headline: 'A title', body: 'A body' },
        { slide: 2, asset_id: B, headline: 'B title', body: '' },
        { slide: 3, asset_id: C, headline: '', body: 'C body' },
      ],
      orderedAssetIds: [B, A, C],
    });

    assert.ok(!('error' in result));
    if ('error' in result) return;

    const slides = result.carousel_slides as Record<string, unknown>[];
    assert.equal(slides.length, 3);
    assert.equal(slides[0]?.asset_id, B);
    assert.equal(slides[0]?.slide, 1);
    assert.equal(slides[0]?.headline, 'B title');
    assert.equal(slides[1]?.asset_id, A);
    assert.equal(slides[1]?.headline, 'A title');
    assert.equal(slides[2]?.body, 'C body');
  });

  test('rejects unknown asset', () => {
    const result = reorderCandidateCarouselSlides({
      source_asset_ids: [A, B],
      carousel_slides: [],
      orderedAssetIds: [A, 'dddddddd-dddd-dddd-dddd-dddddddddddd'],
    });
    assert.ok('error' in result);
  });

  test('rejects duplicate asset', () => {
    const result = reorderCandidateCarouselSlides({
      source_asset_ids: [A, B],
      carousel_slides: [],
      orderedAssetIds: [A, A],
    });
    assert.ok('error' in result);
  });
});

describe('orderedCarouselAssetIds', () => {
  test('uses carousel slide order', () => {
    const ids = orderedCarouselAssetIds([A, B, C], [
      { slide: 3, asset_id: C },
      { slide: 1, asset_id: A },
      { slide: 2, asset_id: B },
    ]);
    assert.deepEqual(ids, [A, B, C]);
  });
});

describe('moveCarouselAssetId', () => {
  test('swaps adjacent ids', () => {
    const next = moveCarouselAssetId([A, B, C], 1, 'left');
    assert.ok(Array.isArray(next));
    assert.deepEqual(next, [B, A, C]);
  });
});
