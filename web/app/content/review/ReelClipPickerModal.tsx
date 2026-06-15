'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { REEL_MAX_CLIPS } from '@fr94/reel-clip-limits';

import type { ClipListRow } from '@/lib/clip-list-types';
import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from './types';

function clipLabel(row: ClipListRow): string {
  const name = row.asset_filename ?? row.content_asset_id.slice(0, 8);
  return `${name} · ${row.duration_sec.toFixed(1)}s`;
}

function ClipThumb({ row }: { row: ClipListRow }) {
  const src = row.thumbnail_url ?? row.asset_thumbnail_url;
  return (
    <div className="aspect-video w-full bg-[var(--bg)]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-[var(--muted)]">
          No thumb
        </div>
      )}
    </div>
  );
}

export function ReelClipPickerModal({
  open,
  candidateId,
  attachedClipIds,
  clipCount,
  maxClips = REEL_MAX_CLIPS,
  onClose,
  onAdded,
}: {
  open: boolean;
  candidateId: string;
  attachedClipIds: string[];
  clipCount: number;
  maxClips?: number;
  onClose: () => void;
  onAdded: (candidate: PostCandidate) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Array<ClipListRow & { attached?: boolean }>>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const attached = useMemo(
    () => new Set(attachedClipIds.map((id) => id.trim().toLowerCase())),
    [attachedClipIds],
  );

  const remainingSlots = Math.max(0, maxClips - clipCount);
  const selectedCount = selected.size;
  const overLimit = selectedCount > remainingSlots;

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '24');
    p.set('candidate_id', candidateId);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [candidateId, q]);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setErr(null);
      try {
        const p = new URLSearchParams(listQuery);
        if (offset > 0) p.set('offset', String(offset));
        const res = await fetch(`/api/content-review/clips?${p}`, { credentials: 'include' });
        const j = await readJsonResponse<{
          items?: Array<ClipListRow & { attached?: boolean }>;
          next_offset?: number | null;
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(j.error || res.statusText);
        const page = j.items ?? [];
        setItems((prev) => (append ? [...prev, ...page] : page));
        setNextOffset(typeof j.next_offset === 'number' ? j.next_offset : null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        if (!append) setItems([]);
        setNextOffset(null);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [listQuery],
  );

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSelected(new Map());
    setErr(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void loadPage(0, false);
  }, [open, loadPage]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function toggleSelect(id: string) {
    const key = id.trim().toLowerCase();
    if (attached.has(key)) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, id.trim());
      return next;
    });
  }

  async function submit() {
    if (selectedCount === 0 || overLimit || submitting) return;
    const clip_ids = [...selected.values()];
    if (clip_ids.length === 0) return;

    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/content-review/candidates/${candidateId}/review-clips`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clip_ids }),
        },
      );
      const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (!json.candidate) throw new Error('Missing updated candidate');
      onAdded(json.candidate);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="reel-clip-picker-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      >
        <header className="shrink-0 border-b border-[var(--border)] px-4 py-3">
          <h2 id="reel-clip-picker-title" className="text-lg font-semibold text-[var(--text)]">
            Add clips from library
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {clipCount}/{maxClips} clips in pool · {remainingSlots} slot
            {remainingSlots === 1 ? '' : 's'} left
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-2 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              void loadPage(0, false);
            }}
          >
            <label className="flex min-w-[180px] flex-1 flex-col text-[var(--muted)]">
              Search
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="mt-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[var(--text)]"
                placeholder="summary, hook, filename…"
              />
            </label>
            <button
              type="submit"
              className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--text)]"
            >
              Search
            </button>
          </form>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-[var(--muted)]">Loading clips…</p>}
          {!loading && err && <p className="text-sm text-[var(--bad)]">{err}</p>}
          {!loading && !err && items.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No clips match your search.</p>
          )}
          {!loading && items.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {items.map((row) => {
                const key = row.id.trim().toLowerCase();
                const isAttached = attached.has(key) || row.attached;
                const isSelected = selected.has(key);

                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={isAttached}
                      onClick={() => toggleSelect(row.id)}
                      className={`relative flex w-full flex-col overflow-hidden rounded border text-left transition-colors ${
                        isAttached
                          ? 'cursor-not-allowed border-[var(--border)] opacity-50'
                          : isSelected
                            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40'
                            : 'border-[var(--border)] hover:border-[var(--accent)]/60'
                      }`}
                    >
                      <ClipThumb row={row} />
                      <div className="space-y-1 p-2">
                        <p className="truncate text-[11px] font-medium text-[var(--text)]" title={clipLabel(row)}>
                          {clipLabel(row)}
                        </p>
                        {row.visual_summary && (
                          <p className="line-clamp-2 text-[10px] leading-snug text-[var(--muted)]">
                            {row.visual_summary}
                          </p>
                        )}
                        {isAttached && (
                          <span className="text-[10px] text-[var(--muted)]">On reel</span>
                        )}
                      </div>
                      {!isAttached && (
                        <span
                          className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded border text-[11px] ${
                            isSelected
                              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]'
                              : 'border-[var(--border)] bg-[var(--surface)]/90 text-[var(--muted)]'
                          }`}
                          aria-hidden
                        >
                          {isSelected ? '✓' : ''}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {nextOffset != null && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadPage(nextOffset, true)}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
          <p className="text-xs text-[var(--muted)]">
            {selectedCount === 0
              ? 'Select clips to expand the reel pool'
              : overLimit
                ? `Too many selected (max ${remainingSlots})`
                : `${selectedCount} selected`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
              onClick={() => void submit()}
              disabled={selectedCount === 0 || overLimit || submitting}
            >
              {submitting
                ? 'Adding…'
                : selectedCount === 1
                  ? 'Add 1 clip'
                  : `Add ${selectedCount} clips`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
