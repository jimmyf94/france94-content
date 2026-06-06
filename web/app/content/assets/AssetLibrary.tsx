'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AssetListRow } from '@/lib/asset-library-types';
import { ASSET_ELIGIBILITY_VALUES } from '@/lib/asset-library-types';

import { AssetCard } from './AssetCard';
import { AssetMediaThumb } from './AssetMediaThumb';
import { AssetDetailDrawer } from './AssetDetailDrawer';
import { ManualUsageModal } from './ManualUsageModal';

type ViewMode = 'grid' | 'table';

function readParam(sp: URLSearchParams, key: string): string {
  return sp.get(key)?.trim() ?? '';
}

export function AssetLibrary() {
  const router = useRouter();
  const sp = useSearchParams();

  const view = (readParam(sp, 'view') as ViewMode) === 'table' ? 'table' : 'grid';

  const filters = useMemo(
    () => ({
      q: readParam(sp, 'q'),
      media_type: readParam(sp, 'media_type'),
      activity: readParam(sp, 'activity'),
      content_lane: readParam(sp, 'content_lane'),
      eligibility: readParam(sp, 'eligibility'),
      used: readParam(sp, 'used'),
      stale_excluded: readParam(sp, 'stale_excluded'),
      quality_min: readParam(sp, 'quality_min'),
      date_from: readParam(sp, 'date_from'),
      date_to: readParam(sp, 'date_to'),
    }),
    [sp],
  );

  const offset = Math.max(0, parseInt(readParam(sp, 'offset') || '0', 10) || 0);

  const [items, setItems] = useState<AssetListRow[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'usage' | undefined>(undefined);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState<'manual_post' | 'manual_story' | 'manual_reel'>(
    'manual_post',
  );
  const [manualAssetId, setManualAssetId] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.media_type) p.set('media_type', filters.media_type);
    if (filters.activity) p.set('activity', filters.activity);
    if (filters.content_lane) p.set('content_lane', filters.content_lane);
    if (filters.eligibility) p.set('eligibility', filters.eligibility);
    if (filters.used) p.set('used', filters.used);
    if (filters.stale_excluded) p.set('stale_excluded', filters.stale_excluded);
    if (filters.quality_min) p.set('quality_min', filters.quality_min);
    if (filters.date_from) p.set('date_from', filters.date_from);
    if (filters.date_to) p.set('date_to', filters.date_to);
    if (view === 'table') p.set('view', 'table');
    if (offset > 0) p.set('offset', String(offset));
    return p.toString();
  }, [filters, view, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams(qs);
      if (!q.has('limit')) q.set('limit', '24');
      const res = await fetch(`/api/content-assets/list?${q}`, { credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof j.error === 'string' ? j.error : 'Failed to load');
        setItems([]);
        setNextOffset(null);
        return;
      }
      setItems((j.items ?? []) as AssetListRow[]);
      setNextOffset(typeof j.next_offset === 'number' ? j.next_offset : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setItems([]);
      setNextOffset(null);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    void load();
  }, [load]);

  function pushParams(next: URLSearchParams) {
    const s = next.toString();
    router.push(s ? `/content/assets?${s}` : '/content/assets');
  }

  function updateFilter(stringPatch: Partial<Record<string, string>>, offset?: number | null) {
    const p = new URLSearchParams(sp.toString());
    if (offset === null || offset === 0) p.delete('offset');
    else if (offset !== undefined) p.set('offset', String(offset));
    for (const [k, v] of Object.entries(stringPatch)) {
      if (v === '' || v == null) p.delete(k);
      else p.set(k, String(v));
    }
    pushParams(p);
  }

  async function patchEligibility(
    id: string,
    candidate_eligibility: (typeof ASSET_ELIGIBILITY_VALUES)[number],
  ) {
    const res = await fetch(`/api/content-assets/${id}/eligibility`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ candidate_eligibility }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      window.alert(typeof j.error === 'string' ? j.error : 'Update failed');
      return;
    }
    void load();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-[var(--text)]">
            FR94 Asset library
          </h1>
          <Link
            href="/content/review"
            className="text-sm text-[var(--accent)] underline"
          >
            Back to review
          </Link>
          <button
            type="button"
            className="ml-auto rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>

        <form
          className="mt-3 flex flex-wrap items-end gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            updateFilter(
              {
                q: String(fd.get('q') ?? ''),
                media_type: String(fd.get('media_type') ?? ''),
                activity: String(fd.get('activity') ?? ''),
                content_lane: String(fd.get('content_lane') ?? ''),
                eligibility: String(fd.get('eligibility') ?? ''),
                used: String(fd.get('used') ?? ''),
                stale_excluded: fd.get('stale_excluded') === 'on' ? '1' : '',
                quality_min: String(fd.get('quality_min') ?? ''),
                date_from: String(fd.get('date_from') ?? ''),
                date_to: String(fd.get('date_to') ?? ''),
              },
              0,
            );
          }}
        >
          <label className="flex flex-col text-[var(--muted)]">
            Search
            <input
              name="q"
              defaultValue={filters.q}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
              placeholder="filename, summary…"
            />
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            Media
            <input
              name="media_type"
              defaultValue={filters.media_type}
              className="w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
              placeholder="video"
            />
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            Activity
            <input
              name="activity"
              defaultValue={filters.activity}
              className="w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            />
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            Lane
            <input
              name="content_lane"
              defaultValue={filters.content_lane}
              className="w-24 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            />
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            Eligibility
            <select
              name="eligibility"
              defaultValue={filters.eligibility}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            >
              <option value="">Any</option>
              {ASSET_ELIGIBILITY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            Used
            <select
              name="used"
              defaultValue={filters.used}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            >
              <option value="">Any</option>
              <option value="used">Used</option>
              <option value="unused">Unused</option>
            </select>
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            Quality ≥
            <input
              name="quality_min"
              defaultValue={filters.quality_min}
              type="number"
              step="0.1"
              className="w-20 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            />
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            From
            <input
              name="date_from"
              type="date"
              defaultValue={filters.date_from}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            />
          </label>
          <label className="flex flex-col text-[var(--muted)]">
            To
            <input
              name="date_to"
              type="date"
              defaultValue={filters.date_to}
              className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[var(--text)]"
            />
          </label>
          <label className="flex items-center gap-1 text-[var(--muted)]">
            <input
              type="checkbox"
              name="stale_excluded"
              defaultChecked={filters.stale_excluded === '1'}
            />
            Stale / excluded only
          </label>
          <button
            type="submit"
            className="rounded border border-[var(--accent)] px-3 py-1.5 text-[var(--text)]"
          >
            Apply
          </button>
        </form>

        <div className="mt-2 flex gap-2 text-xs">
          <button
            type="button"
            className={`rounded border px-2 py-1 ${
              view === 'grid' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)]'
            }`}
            onClick={() => {
              const p = new URLSearchParams(sp.toString());
              p.delete('offset');
              p.delete('view');
              pushParams(p);
            }}
          >
            Grid
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 ${
              view === 'table' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)]'
            }`}
            onClick={() => {
              const p = new URLSearchParams(sp.toString());
              p.delete('offset');
              p.set('view', 'table');
              pushParams(p);
            }}
          >
            Table
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        {loading ? <p className="text-sm text-[var(--muted)]">Loading…</p> : null}
        {err ? <p className="text-sm text-rose-400">{err}</p> : null}
        {!loading && !err && items.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No assets match filters.</p>
        ) : null}

        {view === 'grid' && items.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((row) => (
              <AssetCard
                key={row.id}
                row={row}
                onOpenDetail={() => {
                  setDrawerTab('overview');
                  setDrawerId(row.id);
                }}
                onSetEligibility={(el) => void patchEligibility(row.id, el)}
                onManualUsage={(kind) => {
                  setManualAssetId(row.id);
                  setManualKind(kind);
                  setManualOpen(true);
                }}
                onOpenDrive={() => {
                  const u = row.drive_web_view_link?.trim();
                  if (u) window.open(u, '_blank', 'noopener,noreferrer');
                }}
              />
            ))}
          </div>
        ) : null}

        {view === 'table' && items.length > 0 ? (
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[900px] border-collapse text-left text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                <tr>
                  <th className="p-2">Preview</th>
                  <th className="p-2">File</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Lane</th>
                  <th className="p-2">Eligibility</th>
                  <th className="p-2">Used</th>
                  <th className="min-w-[200px] p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)]">
                    <td className="h-12 w-20 p-1">
                      <AssetMediaThumb
                        thumbnail_link={row.thumbnail_link}
                        poster_url={row.poster_url}
                        still_url={row.still_url}
                        isVideo={(row.mime_type ?? row.media_type ?? '')
                          .toLowerCase()
                          .startsWith('video')}
                        className="h-12 w-20 object-cover"
                        placeholderClassName="flex h-12 w-20 items-center justify-center text-[10px] text-[var(--muted)]"
                      />
                    </td>
                    <td className="max-w-[200px] truncate p-2 font-medium text-[var(--text)]">
                      <button
                        type="button"
                        className="truncate text-left hover:underline"
                        title="Open detail"
                        onClick={() => {
                          setDrawerTab('overview');
                          setDrawerId(row.id);
                        }}
                      >
                        {row.final_filename || row.current_filename || row.original_filename}
                      </button>
                    </td>
                    <td className="p-2 text-[var(--muted)]">{row.media_type}</td>
                    <td className="p-2 text-[var(--muted)]">{row.content_lane}</td>
                    <td className="p-2">{row.candidate_eligibility}</td>
                    <td className="p-2 tabular-nums">{row.usage_count}</td>
                    <td className="p-2 align-top">
                      <div className="flex flex-col gap-1.5">
                        <select
                          className="max-w-[11rem] rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[var(--text)]"
                          aria-label={`Actions for ${row.id}`}
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value;
                            e.target.value = '';
                            if (!v) return;
                            if (
                              v === 'eligible' ||
                              v === 'stale' ||
                              v === 'excluded' ||
                              v === 'manual_only' ||
                              v === 'needs_review'
                            ) {
                              void patchEligibility(row.id, v);
                              return;
                            }
                            if (v === 'drive') {
                              const u = row.drive_web_view_link?.trim();
                              if (u) window.open(u, '_blank', 'noopener,noreferrer');
                              return;
                            }
                            if (v === 'detail') {
                              setDrawerTab('overview');
                              setDrawerId(row.id);
                              return;
                            }
                            if (v === 'history') {
                              setDrawerTab('usage');
                              setDrawerId(row.id);
                              return;
                            }
                            if (
                              v === 'manual_post' ||
                              v === 'manual_story' ||
                              v === 'manual_reel'
                            ) {
                              setManualAssetId(row.id);
                              setManualKind(v);
                              setManualOpen(true);
                            }
                          }}
                        >
                          <option value="">Choose action…</option>
                          <option value="detail">Open detail</option>
                          <option value="history">Usage history</option>
                          <option value="eligible">Mark eligible</option>
                          <option value="stale">Mark stale</option>
                          <option value="excluded">Exclude</option>
                          <option value="manual_only">Manual only</option>
                          <option value="needs_review">Needs review</option>
                          <option value="manual_post">Manual post…</option>
                          <option value="manual_story">Manual story…</option>
                          <option value="manual_reel">Manual reel…</option>
                          <option value="drive">Open in Drive</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {nextOffset != null ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="rounded border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)]"
              onClick={() => updateFilter({}, nextOffset)}
            >
              Load more
            </button>
          </div>
        ) : null}
      </main>

      <AssetDetailDrawer
        open={drawerId != null}
        assetId={drawerId}
        initialTab={drawerTab === 'usage' ? 'usage' : 'overview'}
        onClose={() => {
          setDrawerId(null);
          setDrawerTab(undefined);
        }}
      />

      <ManualUsageModal
        open={manualOpen}
        assetId={manualAssetId}
        initialUsage={manualKind}
        onClose={() => {
          setManualOpen(false);
          setManualAssetId(null);
        }}
        onDone={() => void load()}
      />
    </div>
  );
}
