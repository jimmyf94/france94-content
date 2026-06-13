import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendCarouselAssets } from './append-candidate-carousel-asset.js';

describe('appendCarouselAssets', () => {
  test('appends slides with empty headline/body and renumbers', () => {
    const result = appendCarouselAssets({
      source_asset_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
      source_drive_file_ids: ['drive-1'],
      carousel_slides: [
        {
          slide: 1,
          headline: 'Hook',
          body: 'Body',
          asset_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        },
      ],
      newAssets: [
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          driveFileId: 'drive-2',
        },
      ],
    });

    assert.ok(!('error' in result));
    if ('error' in result) return;

    assert.equal(result.source_asset_ids.length, 2);
    assert.equal(result.source_drive_file_ids.length, 2);
    assert.equal(result.source_drive_file_ids[1], 'drive-2');
    assert.equal(result.carousel_slides.length, 2);

    const slide2 = result.carousel_slides[1] as Record<string, unknown>;
    assert.equal(slide2.slide, 2);
    assert.equal(slide2.headline, '');
    assert.equal(slide2.body, '');
    assert.equal(slide2.asset_id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  test('rejects duplicate asset', () => {
    const result = appendCarouselAssets({
      source_asset_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
      source_drive_file_ids: ['drive-1'],
      carousel_slides: [],
      newAssets: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          driveFileId: 'drive-1',
        },
      ],
    });

    assert.ok('error' in result);
    assert.match(result.error, /already attached/i);
  });

  test('rejects when over max slides', () => {
    const existing = Array.from({ length: 9 }, (_, i) => `id-${i}`);
    const result = appendCarouselAssets({
      source_asset_ids: existing,
      source_drive_file_ids: existing.map((_, i) => `drive-${i}`),
      carousel_slides: existing.map((id, i) => ({
        slide: i + 1,
        headline: '',
        body: '',
        asset_id: id,
      })),
      newAssets: [
        { id: 'new-1', driveFileId: 'drive-new-1' },
        { id: 'new-2', driveFileId: 'drive-new-2' },
      ],
      maxSlides: 10,
    });

    assert.ok('error' in result);
    assert.match(result.error, /limit/i);
  });
});
