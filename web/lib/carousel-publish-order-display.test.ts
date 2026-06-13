import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCarouselPublishOrderRows } from './carousel-publish-order-display.js';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('buildCarouselPublishOrderRows', () => {
  test('sorts by slide field and uses media file names', () => {
    const rows = buildCarouselPublishOrderRows({
      source_asset_ids: [A, B],
      carousel_slides: [
        { slide: 2, asset_id: B, headline: 'b', body: '' },
        { slide: 1, asset_id: A, headline: '', body: '' },
      ],
      mediaFiles: [
        {
          id: 'drive-1',
          name: '2026-05-08_bergerac_run_hill-fatigue-training_reel_A_001.mov',
          mimeType: 'video/mp4',
          thumbnailLink: null,
          webViewLink: null,
          webContentLink: null,
          size: null,
          createdTime: null,
          modifiedTime: null,
          sourceAssetId: A,
        },
        {
          id: 'drive-2',
          name: '2026-05-08_bergerac_run_hill-fatigue-training_reel_B_002.jpg',
          mimeType: 'image/jpeg',
          thumbnailLink: null,
          webViewLink: null,
          webContentLink: null,
          size: null,
          createdTime: null,
          modifiedTime: null,
          sourceAssetId: B,
        },
      ],
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.assetId, A);
    assert.equal(rows[1]?.assetId, B);
    assert.match(rows[0]?.label ?? '', /reel_A_001/);
    assert.match(rows[1]?.label ?? '', /reel_B_002/);
  });
});
