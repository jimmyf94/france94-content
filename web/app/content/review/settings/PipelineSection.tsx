'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  dispatchPipelineRun,
  isPipelineRunBusy,
  type PipelineRunPayload,
} from '@/lib/pipeline-run-client';
import { readJsonResponse } from '@/lib/read-json-response';

import { PostTypeBadge } from '../PostTypeBadge';
import { formatPostTypeLabel } from '../postTypeTheme';

export const PIPELINE_POST_TYPES = [
  'reel',
  'story_sequence',
  'carousel',
  'static_post',
  'sponsor_post',
  'archive_note',
] as const;

export type PipelinePostType = (typeof PIPELINE_POST_TYPES)[number];

const INTERVAL_OPTIONS: { label: string; minutes: number }[] = [
  { label: '5 minutes', minutes: 5 },
  { label: '10 minutes', minutes: 10 },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
  { label: '6 hours', minutes: 360 },
  { label: '12 hours', minutes: 720 },
  { label: '1 day', minutes: 1440 },
  { label: '2 days', minutes: 2880 },
  { label: '7 days', minutes: 10080 },
];

type PipelinePayload = PipelineRunPayload & {
  enabled_post_types: PipelinePostType[];
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

function formatIntervalLabel(minutes: number): string {
  const opt = INTERVAL_OPTIONS.find((o) => o.minutes === minutes);
  if (opt) return opt.label;
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hrs = minutes / 60;
    return hrs === 1 ? '1 hour' : `${hrs} hours`;
  }
  return `${minutes} min`;
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-[var(--border)] py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:max-w-[55%]">
        <div className="text-sm text-[var(--text)]">{label}</div>
        {hint ? <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function PipelineSection({
  onFeedback,
}: {
  onFeedback: (f: { kind: 'good' | 'bad'; msg: string } | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState<'full' | 'candidates_only' | null>(null);
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
    async (body: Partial<PipelinePayload>) => {
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
        onFeedback({ kind: 'good', msg: 'Pipeline settings saved.' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onFeedback({ kind: 'bad', msg });
      } finally {
        setSaving(false);
      }
    },
    [onFeedback],
  );

  const dispatchRun = useCallback(
    async (stage: 'full' | 'candidates_only') => {
      setDispatching(stage);
      setError(null);
      try {
        const json = await dispatchPipelineRun(stage);
        setData(json as PipelinePayload);
        onFeedback({
          kind: 'good',
          msg:
            stage === 'full'
              ? 'Full ingest dispatched to GitHub Actions.'
              : 'Candidate batch dispatched to GitHub Actions.',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onFeedback({ kind: 'bad', msg });
      } finally {
        setDispatching(null);
      }
    },
    [onFeedback],
  );

  const togglePostType = useCallback(
    (type: PipelinePostType, enabled: boolean) => {
      if (!data) return;
      const set = new Set(data.enabled_post_types);
      if (enabled) set.add(type);
      else set.delete(type);
      void patch({ enabled_post_types: [...set] });
    },
    [data, patch],
  );

  const atThreshold = data != null && data.needs_review_count >= data.auto_pause_threshold;
  const runBusy = isPipelineRunBusy(data?.last_run_status ?? null) || dispatching != null;

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading pipeline settings…</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-xs text-[var(--bad)]">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      {data && (
        <>
          <SettingsCard
            title="Auto-ingest"
            description="GitHub Actions checks every 5 minutes; the worker only runs when your chosen interval has passed since the last finished run."
          >
            <FieldRow
              label="Auto-ingest"
              hint="Drive inbox → analyze → rename → geocode → post suggestions"
            >
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void patch({ auto_ingest_enabled: true })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    data.auto_ingest_enabled
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  On
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void patch({ auto_ingest_enabled: false })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    !data.auto_ingest_enabled
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Off
                </button>
              </div>
            </FieldRow>

            <FieldRow label="Run interval" hint={`Currently ${formatIntervalLabel(data.auto_ingest_interval_minutes)}`}>
              <select
                disabled={saving}
                value={data.auto_ingest_interval_minutes}
                onChange={(e) =>
                  void patch({ auto_ingest_interval_minutes: Number.parseInt(e.target.value, 10) })
                }
                className="min-w-[10rem] rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)]"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.minutes} value={o.minutes}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow
              label="Auto-pause threshold"
              hint="Pauses auto-ingest when needs_review count reaches this value"
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  disabled={saving}
                  value={thresholdDraft}
                  onChange={(e) => setThresholdDraft(e.target.value)}
                  className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm tabular-nums text-[var(--text)]"
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
                  Save
                </button>
              </div>
            </FieldRow>

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
              <span>
                In review queue:{' '}
                <span
                  className={`tabular-nums font-semibold ${atThreshold ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}
                >
                  {data.needs_review_count}
                </span>
                <span> / pause at {data.auto_pause_threshold}</span>
              </span>
              <span>
                Last run:{' '}
                <span className="text-[var(--text)]">{formatRelative(data.last_run_finished_at)}</span>
                {data.last_run_status ? (
                  <span className="ml-1 text-[var(--muted)]">({data.last_run_status})</span>
                ) : null}
              </span>
            </div>

            {atThreshold && !data.auto_ingest_enabled && (
              <p className="mt-3 text-xs text-[var(--warn)]">
                Queue is at or above the pause threshold. Turn auto-ingest back on after you review some
                candidates.
              </p>
            )}
          </SettingsCard>

          <SettingsCard
            title="Post type lanes"
            description="Disabled lanes are omitted from the planner prompt — the system will not suggest those post types."
          >
            <ul className="divide-y divide-[var(--border)]">
              {PIPELINE_POST_TYPES.map((type) => {
                const enabled = data.enabled_post_types.includes(type);
                return (
                  <li
                    key={type}
                    className={`flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 ${
                      enabled ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <PostTypeBadge postType={type} />
                      <span className="text-sm text-[var(--text)]">{formatPostTypeLabel(type)}</span>
                      {!enabled ? (
                        <span className="text-xs text-[var(--muted)]">— disabled</span>
                      ) : null}
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={enabled}
                        disabled={saving}
                        onChange={(e) => togglePostType(type, e.target.checked)}
                      />
                      <span className="h-6 w-11 rounded-full bg-[var(--border)] transition-colors peer-checked:bg-[var(--accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]" />
                      <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                    </label>
                  </li>
                );
              })}
            </ul>
          </SettingsCard>

          <SettingsCard
            title="Reel render"
            description="When on, clip-based reels automatically queue a render after generation, approval, or variant creation. Render now in the production workspace always works."
          >
            <FieldRow
              label="Auto reel render"
              hint="Off by default — turn on to restore background rendering without clicking Render now"
            >
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void patch({ auto_reel_render_enabled: true })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    data.auto_reel_render_enabled
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  On
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void patch({ auto_reel_render_enabled: false })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    !data.auto_reel_render_enabled
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Off
                </button>
              </div>
            </FieldRow>
          </SettingsCard>

          <SettingsCard
            title="Manual run"
            description="Trigger GitHub Actions immediately. Use a new candidate batch when the current queue has nothing worth a solo regeneration."
          >
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={runBusy}
                onClick={() => void dispatchRun('full')}
                className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {dispatching === 'full' ? 'Dispatching…' : 'Run full ingest now'}
              </button>
              <button
                type="button"
                disabled={runBusy}
                onClick={() => void dispatchRun('candidates_only')}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
              >
                {dispatching === 'candidates_only'
                  ? 'Dispatching…'
                  : 'Generate candidate batch now'}
              </button>
            </div>
            {runBusy && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Pipeline run in progress ({data.last_run_status})…
              </p>
            )}

            {data.last_run_summary && Object.keys(data.last_run_summary).length > 0 && (
              <details className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-[var(--text)]">
                  Last run summary
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--muted)]">
                  {JSON.stringify(data.last_run_summary, null, 2)}
                </pre>
              </details>
            )}
          </SettingsCard>
        </>
      )}
    </div>
  );
}
