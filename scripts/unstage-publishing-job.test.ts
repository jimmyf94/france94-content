import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveCandidateStatusAfterUnstage,
  UnstagePublishingJobError,
  validateUnstagePublishingJobStatus,
} from './lib/publishing/unstage-publishing-job.ts';

test('resolveCandidateStatusAfterUnstage returns produced when reel render exists', () => {
  assert.equal(resolveCandidateStatusAfterUnstage('produced'), 'produced');
});

test('resolveCandidateStatusAfterUnstage returns approved otherwise', () => {
  assert.equal(resolveCandidateStatusAfterUnstage(null), 'approved');
  assert.equal(resolveCandidateStatusAfterUnstage('rendering'), 'approved');
  assert.equal(resolveCandidateStatusAfterUnstage('queued'), 'approved');
});

test('validateUnstagePublishingJobStatus allows prep states', () => {
  for (const st of [
    'draft',
    'media_prepared',
    'containers_created',
    'processing',
    'ready_to_publish',
    'failed',
  ]) {
    assert.doesNotThrow(() => validateUnstagePublishingJobStatus(st));
  }
});

test('validateUnstagePublishingJobStatus blocks scheduled with cancel hint', () => {
  assert.throws(
    () => validateUnstagePublishingJobStatus('scheduled'),
    (e: unknown) => {
      assert.ok(e instanceof UnstagePublishingJobError);
      assert.equal(e.code, 'blocked_status');
      assert.match(e.message, /Cancel schedule/i);
      return true;
    },
  );
});

test('validateUnstagePublishingJobStatus blocks publishing and published', () => {
  for (const st of ['publishing', 'published']) {
    assert.throws(
      () => validateUnstagePublishingJobStatus(st),
      (e: unknown) => {
        assert.ok(e instanceof UnstagePublishingJobError);
        assert.equal(e.code, 'blocked_status');
        return true;
      },
    );
  }
});
