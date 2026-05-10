'use client';

import { useMemo } from 'react';

import { QueueRow } from './QueueRow';
import type { PostCandidate, StatusTab } from './types';
import { STATUS_TAB_LABEL } from './types';

const TAB_ORDER: StatusTab[] = ['needs_review', 'needs_rewrite', 'approved', 'rejected'];

export function CandidateQueueSidebar({
  candidates,
  counts,
  activeTab,
  onChangeTab,
  selectedId,
  onSelect,
  loading,
  mediaReloadNonce = 0,
}: {
  candidates: PostCandidate[];
  counts: Record<StatusTab, number>;
  activeTab: StatusTab;
  onChangeTab: (t: StatusTab) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  mediaReloadNonce?: number;
}) {
  const visible = useMemo(
    () => candidates.filter((c) => c.status === activeTab),
    [candidates, activeTab],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--text)]">
          Candidates
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--muted)]">
          {visible.length}
        </span>
      </div>
      <div className="shrink-0 border-b border-[var(--border)] p-2">
        <div className="grid grid-cols-2 gap-1">
          {TAB_ORDER.map((t) => {
            const isActive = activeTab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChangeTab(t)}
                className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--surface-2)] text-[var(--text)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <span className="truncate">{STATUS_TAB_LABEL[t]}</span>
                <span className="tabular-nums opacity-80">{counts[t]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto">
        {loading && visible.length === 0 && (
          <p className="p-4 text-sm text-[var(--muted)]">Loading…</p>
        )}
        {!loading && visible.length === 0 && (
          <p className="p-4 text-sm text-[var(--muted)]">Queue empty.</p>
        )}
        <ul className="flex flex-col gap-1 p-2">
          {visible.map((c) => (
            <li key={c.id}>
              <QueueRow
                candidate={c}
                selected={c.id === selectedId}
                onClick={() => onSelect(c.id)}
                mediaReloadNonce={mediaReloadNonce}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
