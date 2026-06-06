import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canDeletePostCandidate } from './lib/asset-usage.ts';

test('canDeletePostCandidate allows needs_review', () => {
  assert.deepEqual(
    canDeletePostCandidate({ candidateStatus: 'needs_review' }),
    { ok: true },
  );
});

test('canDeletePostCandidate blocks ready_to_publish candidate', () => {
  const r = canDeletePostCandidate({ candidateStatus: 'ready_to_publish' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'ready_to_publish');
});

test('canDeletePostCandidate blocks published publishing job', () => {
  const r = canDeletePostCandidate({
    candidateStatus: 'approved',
    publishingJobStatus: 'published',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'publishing_in_flight');
});

test('canDeletePostCandidate blocks rendering production', () => {
  const r = canDeletePostCandidate({
    candidateStatus: 'approved',
    productionJobStatus: 'rendering',
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'production_rendering');
});
