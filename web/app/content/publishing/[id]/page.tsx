import { Suspense } from 'react';

import { PublishingDetailClient } from './PublishingDetailClient';

export default async function PublishingJobPage(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return (
    <Suspense fallback={<p className="p-8 text-[var(--muted)]">Loading…</p>}>
      <PublishingDetailClient jobId={id} />
    </Suspense>
  );
}
