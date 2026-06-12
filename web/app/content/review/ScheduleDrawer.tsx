'use client';

import { useState } from 'react';

import { PublishingScheduleQueue } from './PublishingScheduleQueue';

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function ScheduleDrawer({
  open,
  onClose,
  reloadNonce,
  onRefresh,
  onSelectCandidate,
  selectedCandidateId,
}: {
  open: boolean;
  onClose: () => void;
  reloadNonce: number;
  onRefresh?: () => void;
  onSelectCandidate?: (candidateId: string) => void;
  selectedCandidateId?: string | null;
}) {
  const [stats, setStats] = useState({ scheduled: 0, ready: 0 });

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/50"
        aria-label="Close schedule"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text)]">Publishing queue</h2>
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
              {stats.scheduled} scheduled · {stats.ready} ready
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onRefresh?.()}
              className="cockpit-btn-secondary p-1.5"
              aria-label="Refresh"
              title="Refresh"
            >
              <IconRefresh />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cockpit-btn-secondary p-1.5"
              aria-label="Close"
            >
              <IconX />
            </button>
          </div>
        </div>
        <PublishingScheduleQueue
          variant="column"
          reloadNonce={reloadNonce}
          hideHeader
          onStatsChange={setStats}
          onRefresh={onRefresh}
          onSelectCandidate={(id) => {
            onSelectCandidate?.(id);
            onClose();
          }}
          selectedCandidateId={selectedCandidateId}
        />
      </aside>
    </>
  );
}
