import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getCachedStoredThumbnail,
  setCachedStoredThumbnail,
} from './stored-thumbnail-response-cache';

describe('stored-thumbnail-response-cache', () => {
  it('stores and returns cached jpeg bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    setCachedStoredThumbnail('asset', 'abc-123', jpeg);
    const hit = getCachedStoredThumbnail('asset', 'abc-123');
    assert.ok(hit);
    assert.equal(hit.toString('hex'), jpeg.toString('hex'));
  });

  it('isolates asset and clip keys', () => {
    const asset = Buffer.from('asset');
    const clip = Buffer.from('clip');
    setCachedStoredThumbnail('asset', 'same-id', asset);
    setCachedStoredThumbnail('clip', 'same-id', clip);
    assert.equal(getCachedStoredThumbnail('asset', 'same-id')?.toString(), 'asset');
    assert.equal(getCachedStoredThumbnail('clip', 'same-id')?.toString(), 'clip');
  });
});
