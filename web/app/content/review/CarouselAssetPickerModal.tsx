'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AssetListRow } from '@/lib/asset-library-types';
import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from './types';

import { AssetMediaThumb } from '../assets/AssetMediaThumb';
import { EligibilityBadge } from '../assets/EligibilityBadge';

function assetLabel(row: AssetListRow): string {
  return row.final_filename ?? row.current_filename ?? row.original_filename ?? row.id.slice(0, 8);
}

export function CarouselAssetPickerModal({
  open,
  candidateId,
  attachedAssetIds,
  slideCount,
  maxSlides = 10,
  onClose,
  onAdded,
}: {
  open: boolean;
  candidateId: string;
  attachedAssetIds: string[];
  slideCount: number;
  maxSlides?: number;
  onClose: () => void;
  onAdded: (candidate: PostCandidate) => void;
}) {
  const [q, setQ] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [items, setItems] = useState<AssetListRow[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);

  const attached = useMemo(
    () => new Set(attachedAssetIds.map((id) => id.trim().toLowerCase())),
    [attachedAssetIds],
  );

  const remainingSlots = Math.max(0, maxSlides - slideCount);
  const selectedCount = selected.size;
  const overLimit = selectedCount > remainingSlots;

  const listQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '24');
    if (q.trim()) p.set('q', q.trim());
    if (mediaType.trim()) p.set('media_type', mediaType.trim());
    return p.toString();
  }, [q, mediaType]);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setErr(null);
      try {
        const p = new URLSearchParams(listQuery);
        if (offset > 0) p.set('offset', String(offset));
        const res = await fetch(`/api/content-assets/list?${p}`, { credentials: 'include' });
        const j = await readJsonResponse<{
          items?: AssetListRow[];
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
    setMediaType('');
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
    const asset_ids = [...selected.values()];
    if (asset_ids.length === 0) return;

    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/content-review/candidates/${candidateId}/review-assets`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset_ids }),
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
        aria-labelledby="carousel-asset-picker-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      >
        <header className="shrink-0 border-b border-[var(--border)] px-4 py-3">
          <h2 id="carousel-asset-picker-title" className="text-lg font-semibold text-[var(--text)]">
            Add slides from library
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {slideCount}/{maxSlides} slides · {remainingSlots} slot
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
                placeholder="filename, summary…"
              />
            </label>
            <label className="flex flex-col text-[var(--muted)]">
              Media
              <select
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value)}
                className="mt-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[var(--text)]"
              >
                <option value="">All</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
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
          {loading && <p className="text-sm text-[var(--muted)]">Loading assets…</p>}
          {!loading && err && <p className="text-sm text-[var(--bad)]">{err}</p>}
          {!loading && !err && items.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No assets match your search.</p>
          )}
          {!loading && items.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {items.map((row) => {
                const key = row.id.trim().toLowerCase();
                const isAttached = attached.has(key);
                const isSelected = selected.has(key);
                const isVideo = row.media_type === 'video';
                const warnEligibility =
                  row.candidate_eligibility === 'stale' ||
                  row.candidate_eligibility === 'excluded';

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
                      <div className="aspect-square w-full bg-[var(--bg)]">
                        <AssetMediaThumb
                          thumbnail_link={row.thumbnail_link}
                          poster_url={row.poster_url}
                          still_url={row.still_url}
                          isVideo={isVideo}
                        />
                      </div>
                      <div className="space-y-1 p-2">
                        <p className="truncate text-[11px] text-[var(--text)]" title={assetLabel(row)}>
                          {assetLabel(row)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1">
                          <EligibilityBadge value={row.candidate_eligibility} />
                          {isAttached && (
                            <span className="text-[10px] text-[var(--muted)]">On carousel</span>
                          )}
                          {warnEligibility && !isAttached && (
                            <span className="text-[10px] text-[var(--warn)]">Check eligibility</span>
                          )}
                        </div>
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
              ? 'Select assets to add as new slides'
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
                  ? 'Add 1 slide'
                  : `Add ${selectedCount} slides`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
