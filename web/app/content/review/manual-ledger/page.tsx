'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

type ManualEntry = {
  id: string;
  platform: string;
  post_type: string;
  posted_at: string;
  title: string | null;
  hook: string | null;
  selected_series: string | null;
  related_asset_ids: string[];
  created_at: string;
};

type AssetOption = {
  id: string;
  final_filename: string | null;
  current_filename: string | null;
};

export default function ManualLedgerPage() {
  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [postType, setPostType] = useState('reel');
  const [postedAt, setPostedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [title, setTitle] = useState('');
  const [hook, setHook] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedSeries, setSelectedSeries] = useState('');
  const [visualSummary, setVisualSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [permalink, setPermalink] = useState('');
  const [relatedAssetIds, setRelatedAssetIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ledgerRes, assetsRes] = await Promise.all([
        fetch('/api/content-review/manual-ledger?limit=100', { credentials: 'include' }),
        fetch('/api/content-assets/list?limit=80&eligibility=eligible', {
          credentials: 'include',
        }),
      ]);
      const ledgerJson = await readJsonResponse<{ entries?: ManualEntry[]; error?: string }>(
        ledgerRes,
      );
      if (!ledgerRes.ok) throw new Error(ledgerJson.error || ledgerRes.statusText);
      setEntries(ledgerJson.entries ?? []);

      const assetsJson = await readJsonResponse<{
        assets?: AssetOption[];
        error?: string;
      }>(assetsRes);
      if (assetsRes.ok) setAssets(assetsJson.assets ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAsset = (id: string) => {
    setRelatedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/content-review/manual-ledger', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_type: postType,
          posted_at: new Date(postedAt).toISOString(),
          title: title || null,
          hook: hook || null,
          caption: caption || null,
          selected_series: selectedSeries || null,
          visual_summary: visualSummary || null,
          notes: notes || null,
          instagram_permalink: permalink || null,
          related_asset_ids: relatedAssetIds,
        }),
      });
      const json = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setMessage('Manual post recorded in content ledger.');
      setTitle('');
      setHook('');
      setCaption('');
      setNotes('');
      setPermalink('');
      setRelatedAssetIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 lg:px-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">Manual content ledger</h1>
          <Link
            href="/content/review"
            className="text-sm text-[var(--accent)] underline"
          >
            Back to review
          </Link>
        </div>
        <p className="mx-auto mt-2 max-w-4xl text-sm text-[var(--muted)]">
          Record posts made outside the app so candidate generation avoids duplicate assets and
          themes.
        </p>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-6 lg:px-8">
        {error && (
          <div className="rounded-md border border-[var(--bad)] bg-[var(--bad)]/10 px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-md border border-[var(--good)] bg-[var(--good)]/10 px-3 py-2 text-sm text-[var(--good)]">
            {message}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Add manual post</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Post type
              <select
                value={postType}
                onChange={(e) => setPostType(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              >
                <option value="reel">reel</option>
                <option value="carousel">carousel</option>
                <option value="static_post">static_post</option>
                <option value="story">story</option>
                <option value="story_sequence">story_sequence</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Posted at
              <input
                type="datetime-local"
                value={postedAt}
                onChange={(e) => setPostedAt(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)] sm:col-span-2">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)] sm:col-span-2">
              Hook
              <input
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Series
              <input
                value={selectedSeries}
                onChange={(e) => setSelectedSeries(e.target.value)}
                placeholder="e.g. absurd-mission-life-takeover"
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)] sm:col-span-2">
              Instagram permalink
              <input
                value={permalink}
                onChange={(e) => setPermalink(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)] sm:col-span-2">
              Caption
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)] sm:col-span-2">
              Visual summary
              <textarea
                value={visualSummary}
                onChange={(e) => setVisualSummary(e.target.value)}
                rows={2}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)] sm:col-span-2">
              Notes
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          {assets.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Related assets (optional)
              </div>
              <ul className="scrollbar-thin mt-2 max-h-40 space-y-1 overflow-auto">
                {assets.map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={relatedAssetIds.includes(a.id)}
                        onChange={() => toggleAsset(a.id)}
                      />
                      <span className="truncate font-mono text-xs">
                        {a.final_filename || a.current_filename || a.id}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add to ledger'}
          </button>
        </form>

        <section>
          <h2 className="text-sm font-semibold">Recent manual entries</h2>
          {loading ? (
            <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">No manual posts yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <div className="font-medium">
                    {e.post_type}
                    {e.selected_series ? ` · ${e.selected_series}` : ''}
                  </div>
                  <div className="text-[var(--muted)]">
                    {e.title || '(no title)'} · {new Date(e.posted_at).toLocaleString()}
                  </div>
                  {e.related_asset_ids?.length > 0 && (
                    <div className="mt-1 text-xs text-[var(--muted)]">
                      {e.related_asset_ids.length} asset(s)
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
