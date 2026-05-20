'use client';

import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

type PipelinePayload = {
  auto_ingest_enabled: boolean;
  auto_pause_threshold: number;
  needs_review_count: number;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  last_run_summary: Record<string, unknown> | null;
  updated_at: string;
};

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return new Date(iso).toLocaleString();
}

export function AutoIngestSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PipelinePayload | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState('5');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/content-review/pipeline', { credentials: 'include' });
      const json = await readJsonResponse<PipelinePayload & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setData(json);
      setThresholdDraft(String(json.auto_pause_threshold));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const patch = useCallback(
    async (body: { auto_ingest_enabled?: boolean; auto_pause_threshold?: number }) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch('/api/content-review/pipeline', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await readJsonResponse<PipelinePayload & { error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        setData(json);
        setThresholdDraft(String(json.auto_pause_threshold));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const atThreshold =
    data != null && data.needs_review_count >= data.auto_pause_threshold;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Auto-ingest</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            When enabled, GitHub Actions runs every 30 minutes: Drive inbox → analyze → rename →
            geocode → post suggestions. Pauses automatically when enough candidates need review.
          </p>
        </div>
        {data && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={data.auto_ingest_enabled}
              disabled={loading || saving}
              onChange={(e) => void patch({ auto_ingest_enabled: e.target.checked })}
            />
            <span className={data.auto_ingest_enabled ? 'text-[var(--good)]' : 'text-[var(--muted)]'}>
              {data.auto_ingest_enabled ? 'On' : 'Off'}
            </span>
          </label>
        )}
      </div>

      {loading && <p className="mt-3 text-xs text-[var(--muted)]">Loading pipeline settings…</p>}
      {error && (
        <p className="mt-2 text-xs text-[var(--bad)]">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      {data && !loading && (
        <div className="mt-4 space-y-3 text-xs">
          <div className="flex flex-wrap gap-4 text-[var(--muted)]">
            <span>
              In review queue:{' '}
              <span
                className={`tabular-nums font-semibold ${atThreshold ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}
              >
                {data.needs_review_count}
              </span>
              <span className="text-[var(--muted)]"> / pause at {data.auto_pause_threshold}</span>
            </span>
            <span>
              Last run:{' '}
              <span className="text-[var(--text)]">{formatRelative(data.last_run_finished_at)}</span>
              {data.last_run_status ? (
                <span className="ml-1 text-[var(--muted)]">({data.last_run_status})</span>
              ) : null}
            </span>
          </div>

          <label className="block max-w-xs">
            <span className="text-[var(--muted)]">Auto-pause threshold (needs_review count)</span>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                min={1}
                max={100}
                disabled={saving}
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm text-[var(--text)]"
              />
              <button
                type="button"
                disabled={saving || thresholdDraft === String(data.auto_pause_threshold)}
                onClick={() => {
                  const n = Number.parseInt(thresholdDraft, 10);
                  if (!Number.isFinite(n) || n < 1) {
                    setError('Threshold must be at least 1');
                    return;
                  }
                  void patch({ auto_pause_threshold: n });
                }}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
              >
                Save threshold
              </button>
            </div>
          </label>

          {atThreshold && !data.auto_ingest_enabled && (
            <p className="text-[var(--warn)]">
              Queue is at or above the pause threshold. Turn auto-ingest back on after you review
              some candidates.
            </p>
          )}

          {data.last_run_summary && Object.keys(data.last_run_summary).length > 0 && (
            <details className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <summary className="cursor-pointer font-medium text-[var(--text)]">Last run summary</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--muted)]">
                {JSON.stringify(data.last_run_summary, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
