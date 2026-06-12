'use client';

import { useMemo } from 'react';

import type { ReviewFilters } from './FilterDrawer';
import { FilterToggleButton } from './FilterToggleButton';
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
  filters,
  onChangeFilters,
  filtersOpen,
  onToggleFilters,
  onCloseFilters,
}: {
  candidates: CandidateListItem[];
  counts: Record<StatusTab, number>;
  activeTab: StatusTab;
  onChangeTab: (t: StatusTab) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  firstThumbnailById?: Readonly<Record<string, string | null>>;
  filters?: ReviewFilters;
  onChangeFilters?: (f: ReviewFilters) => void;
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
  onCloseFilters?: () => void;
}) {
  const visible = useMemo(
    () =>
      candidates.filter((c) =>
        activeTab === 'approved'
          ? c.status === 'approved' || c.status === 'produced'
          : c.status === activeTab,
      ),
    [candidates, activeTab],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 pt-3 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Review inbox
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          {filters && onChangeFilters && onToggleFilters && onCloseFilters && (
            <FilterToggleButton
              filters={filters}
              onChangeFilters={onChangeFilters}
              open={filtersOpen ?? false}
              onToggle={onToggleFilters}
              onClose={onCloseFilters}
              popoverAlign="left"
            />
          )}
          <span className="text-[11px] tabular-nums text-[var(--text)]">{visible.length}</span>
        </div>
      </div>
      <div className="shrink-0 border-b border-[var(--border)] p-2">
        <div className="flex flex-col gap-0.5">
          {TAB_ORDER.map((t) => {
            const isActive = activeTab === t;
            const count = counts[t];
            if (count === 0 && !isActive) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChangeTab(t)}
                className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-muted)] font-medium text-[var(--text)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                }`}
              >
                <span className="truncate">{STATUS_TAB_LABEL[t]}</span>
                <span className="shrink-0 tabular-nums text-[11px] opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && visible.length === 0 && (
          <p className="p-3 text-sm text-[var(--muted)]">Loading…</p>
        )}
        {!loading && visible.length === 0 && (
          <p className="p-3 text-sm text-[var(--muted)]">Inbox empty.</p>
        )}
        {visible.length > 0 && (
          <ul
            className="scrollbar-thin flex min-h-0 flex-1 list-none flex-col gap-1 overflow-auto p-2"
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
