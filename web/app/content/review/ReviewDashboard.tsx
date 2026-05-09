'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { readJsonResponse } from '@/lib/read-json-response';

import { CandidateCard } from './CandidateCard';
import type { PostCandidate } from './types';

const DEFAULT_STATUSES = 'needs_review,needs_rewrite';

export function ReviewDashboard() {
  const router = useRouter();
  const urlSp = useSearchParams();

  const [statusFilter, setStatusFilter] = useState(urlSp.get('status') || DEFAULT_STATUSES);
  const [postType, setPostType] = useState(urlSp.get('post_type') || '');
  const [candidateDate, setCandidateDate] = useState(urlSp.get('candidate_date') || '');
  const [priorityMin, setPriorityMin] = useState(urlSp.get('priority_min') || '');
  const [priorityMax, setPriorityMax] = useState(urlSp.get('priority_max') || '');
  const [search, setSearch] = useState(urlSp.get('q') || '');

  const [candidates, setCandidates] = useState<PostCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    q.set('status', statusFilter.trim() || DEFAULT_STATUSES);
    if (postType.trim()) q.set('post_type', postType.trim());
    if (candidateDate.trim()) q.set('candidate_date', candidateDate.trim());
    if (priorityMin.trim()) q.set('priority_min', priorityMin.trim());
    if (priorityMax.trim()) q.set('priority_max', priorityMax.trim());
    if (search.trim()) q.set('q', search.trim());
    return q.toString();
  }, [statusFilter, postType, candidateDate, priorityMin, priorityMax, search]);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-review/candidates?${queryString}`, {
        credentials: 'include',
      });
      const json = await readJsonResponse<{ candidates?: PostCandidate[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      const list = json.candidates ?? [];
      setCandidates(list);
      setDraftNotes((prev) => {
        const next = { ...prev };
        for (const c of list) {
          if (next[c.id] === undefined) next[c.id] = c.reviewer_notes ?? '';
        }
        return next;
      });
      setSelectedId((sid) => {
        if (sid && list.some((c) => c.id === sid)) return sid;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void fetchCandidates();
  }, [fetchCandidates]);

  function applyFiltersToUrl() {
    router.replace(`/content/review?${queryString}`);
  }

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of candidates) {
      m[c.status] = (m[c.status] ?? 0) + 1;
    }
    return m;
  }, [candidates]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Post candidate review</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Fast visual review — no publishing. Shortcuts on selected card: A approve · R reject · W
            needs rewrite (not when typing in notes).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <a href="/content/review/unlock" className="text-[var(--muted)] underline">
            Unlock / session
          </a>
          <button
            type="button"
            className="text-[var(--muted)] underline"
            onClick={async () => {
              await fetch('/api/content-review/logout', {
                method: 'POST',
                credentials: 'include',
              });
              window.location.href = '/content/review/unlock';
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Status (comma-separated)
            <input
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              placeholder={DEFAULT_STATUSES}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Post type
            <input
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
              value={postType}
              onChange={(e) => setPostType(e.target.value)}
              placeholder="reel, carousel…"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Candidate date
            <input
              type="date"
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
              value={candidateDate}
              onChange={(e) => setCandidateDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Priority min
            <input
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
              value={priorityMin}
              onChange={(e) => setPriorityMin(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Priority max
            <input
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
              value={priorityMax}
              onChange={(e) => setPriorityMax(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Search title / hook / captions
            <input
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="keywords"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => applyFiltersToUrl()}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => void fetchCandidates()}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]"
          >
            Refresh
          </button>
          {!loading && candidates.length > 0 && (
            <span className="text-xs text-[var(--muted)]">
              Loaded {candidates.length}
              {Object.keys(statusCounts).length > 0 &&
                ` · ${Object.entries(statusCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}`}
            </span>
          )}
        </div>
      </section>

      {loading && (
        <p className="text-sm text-[var(--muted)]">Loading candidates…</p>
      )}

      {error && (
        <div className="mb-4 rounded border border-[var(--bad)] bg-[var(--surface)] p-3 text-sm text-[var(--bad)]">
          {error}
        </div>
      )}

      {!loading && !error && candidates.length === 0 && (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[var(--muted)]">
          No candidates need review.
        </p>
      )}

      <div className="space-y-8">
        {candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            selected={c.id === selectedId}
            onSelect={() => setSelectedId(c.id)}
            notes={draftNotes[c.id] ?? ''}
            onNotesChange={(v) =>
              setDraftNotes((prev) => ({
                ...prev,
                [c.id]: v,
              }))
            }
            onUpdated={() => void fetchCandidates()}
          />
        ))}
      </div>
    </div>
  );
}
