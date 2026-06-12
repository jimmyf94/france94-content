import { PublishingScheduleQueue } from '../review/PublishingScheduleQueue';

export default function PublishingQueuePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Publishing schedule</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Ready and scheduled posts. Open a row to schedule or publish.
        </p>
      </header>
      <PublishingScheduleQueue variant="page" />
    </div>
  );
}
