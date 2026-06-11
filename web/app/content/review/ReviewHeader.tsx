'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import type { ReviewFilters } from './FilterDrawer';
import { PostTypeBadge } from './PostTypeBadge';

type Chip = { key: string; label: ReactNode; clear: () => void };

export function ReviewHeader({
  pendingCount,
  filters,
  onChangeFilters,
  filtersOpen,
  onToggleFilters,
  onRefresh,
  onHealAssetLedger,
  includeBlocked,
  onToggleIncludeBlocked,
  onGenerateCandidates,
  generatingCandidates,
  generateDisabled,
}: {
  pendingCount: number;
  filters: ReviewFilters;
  onChangeFilters: (f: ReviewFilters) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onRefresh: () => void;
  /** Clears stale `approved` usage rows (e.g. after bulk reject outside normal release). */
  onHealAssetLedger?: () => void;
  includeBlocked?: boolean;
  onToggleIncludeBlocked?: () => void;
  onGenerateCandidates: () => void | Promise<void>;
  generatingCandidates?: boolean;
  generateDisabled?: boolean;
}) {
  const chips = useMemo<Chip[]>(() => {
    const out: Chip[] = [];
    if (filters.postType) {
      out.push({
        key: 'postType',
        label: (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[var(--muted)]">Type</span>
            <PostTypeBadge postType={filters.postType} />
          </span>
        ),
        clear: () => onChangeFilters({ ...filters, postType: '' }),
      });
    }
    if (filters.date) {
      out.push({
        key: 'date',
        label: `Date: ${filters.date}`,
        clear: () => onChangeFilters({ ...filters, date: '' }),
      });
    }
    if (filters.priorityMin) {
      out.push({
        key: 'priorityMin',
        label: `Priority ≥ ${filters.priorityMin}`,
        clear: () => onChangeFilters({ ...filters, priorityMin: '' }),
      });
    }
    if (filters.priorityMax) {
      out.push({
        key: 'priorityMax',
        label: `Priority ≤ ${filters.priorityMax}`,
        clear: () => onChangeFilters({ ...filters, priorityMax: '' }),
      });
    }
    if (filters.search) {
      out.push({
        key: 'search',
        label: `"${filters.search}"`,
        clear: () => onChangeFilters({ ...filters, search: '' }),
      });
    }
    return out;
  }, [filters, onChangeFilters]);

  const generateBusy = generatingCandidates || generateDisabled;

  return (
    <header className="hidden shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:flex lg:px-6">
      <h1 className="text-base font-semibold tracking-tight">FR94 Review</h1>
      <span className="text-sm text-[var(--muted)]">
        <span className="font-semibold tabular-nums text-[var(--text)]">{pendingCount}</span>{' '}
        pending
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.clear}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          >
            {c.label}
            <span className="text-[var(--muted)]">×</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggleFilters}
        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
          filtersOpen
            ? 'border-[var(--accent)] text-[var(--accent)]'
            : 'border-[var(--border)] text-[var(--muted)]'
        }`}
        aria-expanded={filtersOpen}
      >
        Filters
      </button>
      <button
        type="button"
        onClick={onRefresh}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
      >
        Refresh
      </button>
      {onHealAssetLedger ? (
        <button
          type="button"
          title="Remove approved asset reservations left on rejected or draft candidates, then refresh the queue"
          onClick={onHealAssetLedger}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--warn)] hover:text-[var(--warn)]"
        >
          Heal ledger
        </button>
      ) : null}
      {onToggleIncludeBlocked ? (
        <button
          type="button"
          onClick={onToggleIncludeBlocked}
          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
            includeBlocked
              ? 'border-[var(--warn)] text-[var(--warn)]'
              : 'border-[var(--border)] text-[var(--muted)]'
          }`}
          title="Show candidates marked blocked by content collision check"
        >
          {includeBlocked ? 'Showing blocked' : 'Hide blocked'}
        </button>
      ) : null}
      <button
        type="button"
        disabled={generateBusy}
        onClick={() => void onGenerateCandidates()}
        className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {generatingCandidates ? 'Generating…' : 'Generate'}
      </button>
      <Link
        href="/content/publishing"
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
      >
        Schedule
      </Link>
    </header>
  );
}
