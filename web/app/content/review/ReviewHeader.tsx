'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

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
}: {
  pendingCount: number;
  filters: ReviewFilters;
  onChangeFilters: (f: ReviewFilters) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onRefresh: () => void;
  /** Clears stale `approved` usage rows (e.g. after bulk reject outside normal release). */
  onHealAssetLedger?: () => void;
}) {
  const [pipelineOn, setPipelineOn] = useState<boolean | null>(null);
  const [pipelineLastRun, setPipelineLastRun] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/content-review/pipeline', { credentials: 'include' });
        const json = await readJsonResponse<{
          auto_ingest_enabled?: boolean;
          last_run_finished_at?: string | null;
        }>(res);
        if (!res.ok || cancelled) return;
        setPipelineOn(Boolean(json.auto_ingest_enabled));
        setPipelineLastRun(json.last_run_finished_at ?? null);
      } catch {
        if (!cancelled) {
          setPipelineOn(null);
          setPipelineLastRun(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pipelinePill = useMemo(() => {
    if (pipelineOn === null) return null;
    if (!pipelineOn) {
      return (
        <Link
          href="/content/review/settings"
          className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-[var(--muted)] hover:border-[var(--accent)]"
          title="Auto-ingest is off"
        >
          Auto-ingest off
        </Link>
      );
    }
    const rel =
      pipelineLastRun != null
        ? (() => {
            const t = new Date(pipelineLastRun).getTime();
            if (Number.isNaN(t)) return '';
            const mins = Math.round((Date.now() - t) / 60_000);
            if (mins < 1) return 'just now';
            if (mins < 60) return `${mins}m ago`;
            return `${Math.round(mins / 60)}h ago`;
          })()
        : '';
    return (
      <Link
        href="/content/review/settings"
        className="rounded-full border border-[var(--good)] px-2.5 py-0.5 text-[11px] text-[var(--good)]"
        title="Auto-ingest checks every 5 min; runs at your configured interval"
      >
        Auto-ingest on{rel ? ` · last ${rel}` : ''}
      </Link>
    );
  }, [pipelineOn, pipelineLastRun]);

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

  return (
    <header className="hidden shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:flex lg:px-6">
      <h1 className="text-base font-semibold tracking-tight">FR94 Review</h1>
      <span className="text-sm text-[var(--muted)]">
        <span className="font-semibold tabular-nums text-[var(--text)]">{pendingCount}</span>{' '}
        pending
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {pipelinePill}
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
      <Link
        href="/content/assets"
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
      >
        Asset library
      </Link>
      <Link
        href="/content/review/settings"
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
      >
        Settings
      </Link>
      <button
        type="button"
        onClick={async () => {
          try {
            await fetch('/api/auth/signout', {
              method: 'POST',
              credentials: 'include',
            });
          } catch {
            /* ignore */
          }
          window.location.href = '/login';
        }}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
      >
        Log out
      </button>
    </header>
  );
}
