import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assessPublishingEligibility } from './lib/publishing/eligibility.ts';

const BASE_CANDIDATE = {
  id: '00000000-0000-4000-8000-000000000001',
  post_type: 'reel',
  caption_fr: 'test',
  caption_en: null,
  hashtags: [],
  story_frames: [],
  reel_instructions: { version: 'clips-v1', clips: [{ clip_id: 'c1' }] },
  carousel_slides: [],
  static_post_instructions: {},
  source_asset_ids: ['00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011'],
  source_drive_file_ids: [],
  status: 'approved',
};

const MULTI_VIDEO = [
  {
    order: 1,
    asset_id: '00000000-0000-4000-8000-000000000010',
    drive_file_id: 'd1',
    mime_type: 'video/mp4',
    media_type: 'video',
  },
  {
    order: 2,
    asset_id: '00000000-0000-4000-8000-000000000011',
    drive_file_id: 'd2',
    mime_type: 'video/mp4',
    media_type: 'video',
  },
];

test('clip reel without produced render is blocked', () => {
  const r = assessPublishingEligibility(BASE_CANDIDATE, MULTI_VIDEO);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /rendering/i);
});

test('clip reel with produced render passes multi-source eligibility', () => {
  const r = assessPublishingEligibility(BASE_CANDIDATE, MULTI_VIDEO, {
    hasProducedReelRender: true,
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.publishType, 'reel');
});

test('single full-video reel still requires one video without render context', () => {
  const candidate = {
    ...BASE_CANDIDATE,
    reel_instructions: {},
    source_asset_ids: ['00000000-0000-4000-8000-000000000010'],
  };
  const r = assessPublishingEligibility(candidate, [MULTI_VIDEO[0]!]);
  assert.equal(r.ok, true);
});
