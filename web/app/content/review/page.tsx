import { Suspense } from 'react';

import { ReviewDashboard } from './ReviewDashboard';

export default function ContentReviewPage() {
  return (
    <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading…</p>}>
      <ReviewDashboard />
    </Suspense>
  );
}
