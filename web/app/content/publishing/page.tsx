import Link from 'next/link';

import { PublishingScheduleQueue } from '../review/PublishingScheduleQueue';

export default function PublishingQueuePage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]">
      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <Link
          href="/content/review"
          className="text-sm text-[var(--accent)] underline hover:opacity-80"
        >
          Back to review
        </Link>
      </div>
      <PublishingScheduleQueue variant="page" />
    </div>
  );
}
