'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

type Fr94RouteOperation =
  | 'asset_analysis_image'
  | 'asset_analysis_video_sampled'
  | 'asset_analysis_video_full'
  | 'candidate_generation'
  | 'candidate_regeneration'
  | 'caption_rewrite_basic'
  | 'caption_rewrite_premium'
  | 'ranking'
  | 'final_editorial_pass';

type EffectiveRoute = {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  useCache: boolean;
  requireJson: boolean;
  thinkingLevel: string | null;
};

type RoutePayload = {
  operation: Fr94RouteOperation;
  effective: EffectiveRoute;
  modelLockedByEnv: boolean;
  dbRow: {
    model: string;
    temperature: number;
    max_output_tokens: number;
    use_cache: boolean;
    require_json: boolean;
    thinking_level: string | null;
    updated_at: string | null;
  } | null;
};

type SettingsResponse = {
  routes: RoutePayload[];
  runtimeHints: {
    fr94PromptVersion: string;
    geminiExplicitCaching: boolean;
    llmLoggingDisabled: boolean;
  };
};

type UsagePoint = {
  day: string;
  outputTokens: number;
  inputTokens: number;
  totalTokens: number;
  callCount: number;
  failedCount: number;
};

type UsageResponse = {
  days: number;
  series: UsagePoint[];
  totals: {
    outputTokens: number;
    inputTokens: number;
    totalTokens: number;
    callCount: number;
    failedCount: number;
  };
  runtimeHints: SettingsResponse['runtimeHints'];
};

const ROUTE_META: Record<Fr94RouteOperation, { title: string; hint: string }> = {
  asset_analysis_image: {
    title: 'Asset analysis (image)',
    hint: 'Direct image analysis in the ingest worker.',
  },
  asset_analysis_video_sampled: {
    title: 'Asset analysis (video sampled + audio)',
    hint: 'Frame-based video analysis; audio transcription in the same worker also uses this route.',
  },
  asset_analysis_video_full: {
    title: 'Asset analysis (video full)',
    hint: 'Reserved for full-video analysis when wired in the worker.',
  },
  candidate_generation: {
    title: 'Post candidate generation',
    hint: 'Planner batch in generate-post-candidates.',
  },
  candidate_regeneration: {
    title: 'Candidate regeneration (rewrite)',
    hint: 'Review dashboard rewrite / regenerate.',
  },
  caption_rewrite_basic: {
    title: 'Caption rewrite (basic)',
    hint: 'Reserved for lighter caption passes.',
  },
  caption_rewrite_premium: {
    title: 'Caption rewrite (premium)',
    hint: 'Reserved for heavier caption passes.',
  },
  ranking: {
    title: 'Ranking',
    hint: 'Reserved for ranking passes.',
  },
  final_editorial_pass: {
    title: 'Final editorial pass',
    hint: 'Reserved for final editorial.',
  },
};

const THINKING_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Off' },
  { value: 'THINKING_LEVEL_UNSPECIFIED', label: 'Unspecified' },
  { value: 'MINIMAL', label: 'Minimal' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

function padOutputSeries(days: number, series: UsagePoint[]): { day: string; outputTokens: number }[] {
  const end = new Date();
  const map = new Map(series.map((p) => [p.day, p.outputTokens]));
  const out: { day: string; outputTokens: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, outputTokens: map.get(key) ?? 0 });
  }
  return out;
}

function TokenSparkline({
  days,
  series,
}: {
  days: number;
  series: UsagePoint[];
}) {
  const padded = useMemo(() => padOutputSeries(days, series), [days, series]);
  const w = 520;
  const h = 140;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxY = Math.max(1, ...padded.map((p) => p.outputTokens));
  const pts = padded.map((p, i) => {
    const x = padL + (padded.length <= 1 ? innerW / 2 : (i / (padded.length - 1)) * innerW);
    const y = padT + innerH - (p.outputTokens / maxY) * innerH;
    return { x, y, day: p.day, v: p.outputTokens };
  });
  const pathD =
    pts.length === 0
      ? ''
      : pts.length === 1
        ? `M ${pts[0].x} ${pts[0].y}`
        : pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const firstDay = padded[0]?.day ?? '';
  const lastDay = padded[padded.length - 1]?.day ?? '';

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      className="max-h-40 text-[var(--muted)]"
      role="img"
      aria-label="Output tokens per day"
    >
      <rect x="0" y="0" width={w} height={h} fill="transparent" />
      <line
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
        stroke="var(--border)"
        strokeWidth="1"
      />
      <text x={padL} y={h - 6} fontSize="10" fill="currentColor">
        {firstDay}
      </text>
      <text x={padL + innerW} y={h - 6} fontSize="10" fill="currentColor" textAnchor="end">
        {lastDay}
      </text>
      <text x={4} y={padT + 10} fontSize="10" fill="currentColor">
        {maxY}
      </text>
      <text x={4} y={padT + innerH} fontSize="10" fill="currentColor">
        0
      </text>
      {pathD ? (
        <path
          d={pathD}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {pts.map((p) => (
        <circle key={p.day} cx={p.x} cy={p.y} r="3" fill="var(--accent)" opacity={0.85} />
      ))}
    </svg>
  );
}

type Draft = {
  model: string;
  temperature: number;
  max_output_tokens: number;
  use_cache: boolean;
  require_json: boolean;
  thinking_level: string;
};

function effectiveToDraft(e: EffectiveRoute): Draft {
  return {
    model: e.model,
    temperature: e.temperature,
    max_output_tokens: e.maxOutputTokens,
    use_cache: e.useCache,
    require_json: e.requireJson,
    thinking_level: e.thinkingLevel ?? '',
  };
}

export default function LlmSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RoutePayload[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [usageDays, setUsageDays] = useState(30);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [hints, setHints] = useState<SettingsResponse['runtimeHints'] | null>(null);

  const modelSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const r of routes) {
      s.add(r.effective.model);
      if (r.dbRow) s.add(r.dbRow.model);
    }
    return [...s].sort();
  }, [routes]);

  const loadSettings = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/content-review/llm-settings', { credentials: 'include' });
      const json = await readJsonResponse<SettingsResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setRoutes(json.routes);
      setHints(json.runtimeHints);
      const d: Record<string, Draft> = {};
      for (const r of json.routes) {
        d[r.operation] = effectiveToDraft(r.effective);
      }
      setDrafts(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRoutes([]);
      setDrafts({});
    }
  }, []);

  const loadUsage = useCallback(async (days: number) => {
    setUsageErr(null);
    try {
      const res = await fetch(`/api/content-review/llm-usage?days=${days}`, {
        credentials: 'include',
      });
      const json = await readJsonResponse<UsageResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setUsage(json);
    } catch (e) {
      setUsageErr(e instanceof Error ? e.message : String(e));
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await loadSettings();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSettings]);

  useEffect(() => {
    void loadUsage(usageDays);
  }, [usageDays, loadUsage]);

  const updateDraft = useCallback((op: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const cur = prev[op];
      if (!cur) return prev;
      return { ...prev, [op]: { ...cur, ...patch } };
    });
  }, []);

  const saveRoute = useCallback(
    async (operation: Fr94RouteOperation) => {
      const d = drafts[operation];
      if (!d) return;
      setSaving((s) => ({ ...s, [operation]: true }));
      try {
        const res = await fetch('/api/content-review/llm-settings', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation,
            model: d.model.trim(),
            temperature: d.temperature,
            max_output_tokens: Math.round(d.max_output_tokens),
            use_cache: d.use_cache,
            require_json: d.require_json,
            thinking_level: d.thinking_level === '' ? null : d.thinking_level,
          }),
        });
        const json = await readJsonResponse<{ error?: unknown }>(res);
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : res.statusText);
        await loadSettings();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving((s) => ({ ...s, [operation]: false }));
      }
    },
    [drafts, loadSettings],
  );

  const resetRoute = useCallback(
    async (operation: Fr94RouteOperation) => {
      setSaving((s) => ({ ...s, [operation]: true }));
      try {
        const res = await fetch(
          `/api/content-review/llm-settings?operation=${encodeURIComponent(operation)}`,
          { method: 'DELETE', credentials: 'include' },
        );
        const json = await readJsonResponse<{ error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        await loadSettings();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving((s) => ({ ...s, [operation]: false }));
      }
    },
    [loadSettings],
  );

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-6">
        <Link
          href="/content/review"
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
        >
          Back to review
        </Link>
        <h1 className="text-base font-semibold tracking-tight">LLM settings</h1>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 lg:px-6">
        {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {error && (
          <div className="rounded-md border border-[var(--bad)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setError(null);
                void loadSettings();
              }}
            >
              Retry
            </button>
          </div>
        )}

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Output tokens per day</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                From <code className="text-[11px]">llm_call_logs</code> (UTC days). Requires the
                usage RPC migration applied in Supabase.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              Range
              <select
                value={usageDays}
                onChange={(e) => setUsageDays(Number(e.target.value))}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[var(--text)]"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          </div>
          {usageErr && (
            <p className="mt-2 text-xs text-[var(--warn)]">{usageErr}</p>
          )}
          {usage && (
            <>
              <div className="mt-3 text-xs text-[var(--muted)]">
                <span className="tabular-nums text-[var(--text)]">{usage.totals.outputTokens}</span>{' '}
                output tokens ·{' '}
                <span className="tabular-nums text-[var(--text)]">{usage.totals.callCount}</span> calls
                {usage.totals.failedCount > 0 ? (
                  <>
                    {' '}
                    ·{' '}
                    <span className="text-[var(--warn)]">{usage.totals.failedCount}</span> failed
                  </>
                ) : null}
              </div>
              <div className="mt-2 overflow-x-auto">
                <TokenSparkline days={usage.days} series={usage.series} />
              </div>
            </>
          )}
        </section>

        {(hints ?? usage?.runtimeHints) && (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--muted)]">
            <span className="font-medium text-[var(--text)]">Runtime</span>
            <span className="mx-2">·</span>
            Prompt <code className="text-[11px]">{hints?.fr94PromptVersion ?? usage?.runtimeHints.fr94PromptVersion}</code>
            <span className="mx-2">·</span>
            Explicit cache{' '}
            {(hints?.geminiExplicitCaching ?? usage?.runtimeHints.geminiExplicitCaching) ? 'on' : 'off'}
            <span className="mx-2">·</span>
            LLM logging{' '}
            {(hints?.llmLoggingDisabled ?? usage?.runtimeHints.llmLoggingDisabled) ? 'disabled' : 'enabled'}
          </section>
        )}

        <datalist id="fr94-model-suggestions">
          {modelSuggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        <div className="space-y-4">
          {routes.map((r) => {
            const meta = ROUTE_META[r.operation];
            const d = drafts[r.operation];
            if (!d) return null;
            const busy = saving[r.operation] === true;
            return (
              <section
                key={r.operation}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="mb-3">
                  <h2 className="text-sm font-semibold">{meta.title}</h2>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{meta.hint}</p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{r.operation}</p>
                  {r.dbRow?.updated_at && (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      DB row updated {new Date(r.dbRow.updated_at).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="text-[var(--muted)]">Model</span>
                    <input
                      type="text"
                      list="fr94-model-suggestions"
                      disabled={r.modelLockedByEnv || busy}
                      value={d.model}
                      onChange={(e) => updateDraft(r.operation, { model: e.target.value })}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm disabled:opacity-60"
                    />
                    {r.modelLockedByEnv && (
                      <span className="mt-1 block text-[10px] text-[var(--warn)]">
                        Locked by <code className="text-[10px]">FR94_MODEL_{r.operation.toUpperCase()}</code> in
                        environment.
                      </span>
                    )}
                  </label>

                  <label className="block text-xs">
                    <span className="text-[var(--muted)]">
                      Temperature <span className="tabular-nums">({d.temperature.toFixed(2)})</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      disabled={busy}
                      value={d.temperature}
                      onChange={(e) =>
                        updateDraft(r.operation, { temperature: Number.parseFloat(e.target.value) })
                      }
                      className="mt-2 w-full"
                    />
                  </label>

                  <label className="block text-xs sm:col-span-2">
                    <span className="text-[var(--muted)]">Max output tokens</span>
                    <input
                      type="number"
                      min={1}
                      max={32768}
                      disabled={busy}
                      value={d.max_output_tokens}
                      onChange={(e) =>
                        updateDraft(r.operation, {
                          max_output_tokens: Number.parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={d.use_cache}
                      onChange={(e) => updateDraft(r.operation, { use_cache: e.target.checked })}
                    />
                    Use explicit Gemini context cache when enabled globally
                  </label>

                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={d.require_json}
                      onChange={(e) => updateDraft(r.operation, { require_json: e.target.checked })}
                    />
                    Require JSON response
                  </label>

                  <label className="block text-xs sm:col-span-2">
                    <span className="text-[var(--muted)]">Thinking level</span>
                    <select
                      disabled={busy}
                      value={d.thinking_level}
                      onChange={(e) => updateDraft(r.operation, { thinking_level: e.target.value })}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm"
                    >
                      {THINKING_OPTIONS.map((o) => (
                        <option key={o.label} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveRoute(r.operation)}
                    className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !r.dbRow}
                    onClick={() => void resetRoute(r.operation)}
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                  >
                    Reset to code defaults
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
