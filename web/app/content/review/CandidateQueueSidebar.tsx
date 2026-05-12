'use client';

import { useMemo } from 'react';

import { QueueRow } from './QueueRow';
import type { CandidateListItem, StatusTab } from './types';
import { STATUS_TAB_LABEL } from './types';

const TAB_ORDER: StatusTab[] = [
  'needs_review',
  'needs_rewrite',
  'approved',
  'ready_to_publish',
  'rejected',
];

export function CandidateQueueSidebar({
  candidates,
  counts,
  activeTab,
  onChangeTab,
  selectedId,
  onSelect,
  loading,
  firstThumbnailById = {},
}: {
  candidates: CandidateListItem[];
  counts: Record<StatusTab, number>;
  activeTab: StatusTab;
  onChangeTab: (t: StatusTab) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  /** Populated by parent via one bulk `/files-bulk` call (not per-row Drive lists). */
  firstThumbnailById?: Readonly<Record<string, string | null>>;
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
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
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
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && visible.length === 0 && (
          <p className="p-4 text-sm text-[var(--muted)]">Loading…</p>
        )}
        {!loading && visible.length === 0 && (
          <p className="p-4 text-sm text-[var(--muted)]">Queue empty.</p>
        )}
        {visible.length > 0 && (
          <ul
            className="scrollbar-thin flex min-h-0 flex-1 list-none flex-col gap-2.5 overflow-auto p-2.5"
            role="list"
          >
            {visible.map((c) => (
              <li key={c.id} className="[content-visibility:auto]">
                <QueueRow
                  candidate={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                  firstThumbnailUrl={firstThumbnailById[c.id] ?? null}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
