'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  buildPromptKeysByGroup,
  PIPELINE_STEPS,
  PROMPT_GROUP_LABEL,
  PROMPT_GROUP_ORDER,
  PROMPT_META_BY_KEY,
  type PromptGroupKey,
  type StablePromptKey,
} from '@fr94/ai/prompts/pipeline-map-data.js';

import { readJsonResponse } from '@/lib/read-json-response';

import { PipelineSection } from './PipelineSection';

type Fr94RouteOperation =
  | 'asset_analysis_image'
  | 'asset_analysis_video_sampled'
  | 'asset_analysis_video_full'
  | 'candidate_generation'
  | 'candidate_regeneration'
  | 'caption_rewrite_basic'
  | 'caption_rewrite_premium'
  | 'ranking'
  | 'final_editorial_pass'
  | 'collision_check';

type EffectiveRoute = {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  useCache: boolean;
  requireJson: boolean;
  thinkingLevel: string | null;
};

type RouteTelemetry = {
  days: number;
  callCount: number;
  failedCount: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
};

type RoutePayload = {
  operation: Fr94RouteOperation;
  effective: EffectiveRoute;
  modelLockedByEnv: boolean;
  telemetry: RouteTelemetry;
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
  telemetryRpcError?: string | null;
  telemetryDays?: number;
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

type ModelDailyRow = {
  day: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  estimatedCostUsd: number | null;
};

type OperationDailyRow = {
  day: string;
  operation: string;
  callCount: number;
  outputTokens: number;
};

type UsageResponse = {
  days: number;
  series: UsagePoint[];
  byModelDaily: ModelDailyRow[];
  byOperationDaily: OperationDailyRow[];
  breakdownRpcErrors?: { model: string | null; operation: string | null };
  totals: {
    outputTokens: number;
    inputTokens: number;
    totalTokens: number;
    callCount: number;
    failedCount: number;
  };
  runtimeHints: SettingsResponse['runtimeHints'];
  cost?: {
    estimatedTotalUsd: number | null;
    estimatedDailyUsd: number | null;
    estimatedWeeklyUsd: number | null;
    pricedModelCount: number;
    unpricedModelCount: number;
    note: string;
  };
};

const ROUTE_META: Record<Fr94RouteOperation, { title: string; hint: string }> = {
  asset_analysis_image: {
    title: 'Asset analysis (image)',
    hint: 'Direct image analysis in the ingest worker.',
  },
  asset_analysis_video_sampled: {
    title: 'Asset analysis (video sampled + audio)',
    hint: 'Frame-based video analysis; audio transcription shares the sampled route.',
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
  collision_check: {
    title: 'Content collision check',
    hint: 'Per-candidate judge after planner insert (generate-post-candidates).',
  },
};

/** Friendly labels for `operation` in llm_call_logs charts */
const OPERATION_CHART_LABELS: Record<string, string> = {
  asset_analysis_image: 'Image analysis',
  asset_analysis_video_sampled: 'Video / audio analysis',
  asset_analysis_video_full: 'Video full analysis',
  candidate_generation: 'Post generation',
  candidate_regeneration: 'Candidate rewrite',
  caption_rewrite_basic: 'Caption rewrite (basic)',
  caption_rewrite_premium: 'Caption rewrite (premium)',
  ranking: 'Ranking',
  final_editorial_pass: 'Editorial pass',
  collision_check: 'Collision check',
};

function operationChartLabel(op: string): string {
  return OPERATION_CHART_LABELS[op] ?? op.replace(/_/g, ' ');
}

function formatTelemetryWhen(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleString();
}

function formatUsd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  if (amount < 0.01 && amount > 0) return '<$0.01';
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function RouteTelemetryPanel({
  telemetry,
  telemetryRpcError,
  model,
}: {
  telemetry: RouteTelemetry;
  telemetryRpcError: string | null;
  model: string;
}) {
  const { days, callCount, failedCount, lastSuccessAt, lastErrorAt, lastErrorMessage } = telemetry;
  const hasCalls = callCount > 0;

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
        Last {days} days · llm_call_logs
      </div>
      {telemetryRpcError ? (
        <p className="mt-1 text-[10px] text-[var(--warn)]">
          Telemetry unavailable — apply migration{' '}
          <code className="text-[9px]">20260603120000_llm_route_telemetry</code>: {telemetryRpcError}
        </p>
      ) : null}
      <dl className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted)]">Calls</dt>
          <dd className="tabular-nums text-[var(--text)]">
            {hasCalls ? callCount.toLocaleString() : '0'}
            {failedCount > 0 ? (
              <span className="text-[var(--warn)]"> ({failedCount} failed)</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Est. cost ({model})</dt>
          <dd className="tabular-nums text-[var(--text)]">
            {formatUsd(telemetry.estimatedCostUsd)}
            {telemetry.estimatedCostUsd == null && hasCalls ? (
              <span className="text-[var(--muted)]"> (unknown model rate)</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Last success</dt>
          <dd className="text-[var(--text)]" title={lastSuccessAt ?? undefined}>
            {formatTelemetryWhen(lastSuccessAt)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Last error</dt>
          <dd className="text-[var(--text)]" title={lastErrorAt ?? lastErrorMessage ?? undefined}>
            {formatTelemetryWhen(lastErrorAt)}
            {lastErrorMessage ? (
              <span className="mt-0.5 block truncate text-[10px] text-[var(--warn)]" title={lastErrorMessage}>
                {lastErrorMessage}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Latency p50</dt>
          <dd className="tabular-nums text-[var(--text)]">
            {telemetry.latencyP50Ms != null ? `${Math.round(telemetry.latencyP50Ms)} ms` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">Latency p95</dt>
          <dd className="tabular-nums text-[var(--text)]">
            {telemetry.latencyP95Ms != null ? `${Math.round(telemetry.latencyP95Ms)} ms` : '—'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--muted)]">Tokens in / out</dt>
          <dd className="tabular-nums text-[var(--text)]">
            {telemetry.inputTokens.toLocaleString()} / {telemetry.outputTokens.toLocaleString()}
          </dd>
        </div>
      </dl>
      {!hasCalls && !telemetryRpcError ? (
        <p className="mt-2 text-[10px] text-[var(--muted)]">No logged calls for this route in the window.</p>
      ) : null}
    </div>
  );
}

const THINKING_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Off' },
  { value: 'THINKING_LEVEL_UNSPECIFIED', label: 'Unspecified' },
  { value: 'MINIMAL', label: 'Minimal' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

type PromptRow = {
  key: StablePromptKey;
  effectiveBody: string;
  source: 'db' | 'file';
  fileDefaultBody: string;
  dbBody: string | null;
  updated_at: string | null;
  fileBasename: string;
};

type PromptsResponse = {
  prompts: PromptRow[];
};

const ROUTE_ORDER: Fr94RouteOperation[] = [
  'asset_analysis_image',
  'asset_analysis_video_sampled',
  'asset_analysis_video_full',
  'candidate_generation',
  'candidate_regeneration',
  'caption_rewrite_basic',
  'caption_rewrite_premium',
  'ranking',
  'final_editorial_pass',
  'collision_check',
];

function estimateTokensApprox(charCount: number): number {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / 4);
}

function padDays<T extends { day: string }>(
  days: number,
  rows: T[],
  empty: Omit<T, 'day'> & { day?: never },
): T[] {
  const end = new Date();
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: T[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    const existing = map.get(key);
    if (existing) out.push(existing);
    else out.push({ ...empty, day: key } as T);
  }
  return out;
}

function UsageSection({
  usageDays,
  onChangeDays,
  usage,
  usageErr,
}: {
  usageDays: number;
  onChangeDays: (n: number) => void;
  usage: UsageResponse | null;
  usageErr: string | null;
}) {
  const [hover, setHover] = useState<{
    day: string;
    clientX: number;
    clientY: number;
  } | null>(null);

  const outputByDay = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of usage?.byModelDaily ?? []) {
      if (!m.has(r.day)) m.set(r.day, {});
      const row = m.get(r.day)!;
      row[r.model] = (row[r.model] ?? 0) + r.outputTokens;
    }
    return m;
  }, [usage?.byModelDaily]);

  const opsByDay = useMemo(() => {
    const m = new Map<string, { callsByOp: Record<string, number>; tokensByOp: Record<string, number> }>();
    for (const r of usage?.byOperationDaily ?? []) {
      if (!m.has(r.day)) m.set(r.day, { callsByOp: {}, tokensByOp: {} });
      const row = m.get(r.day)!;
      row.callsByOp[r.operation] = (row.callsByOp[r.operation] ?? 0) + r.callCount;
      row.tokensByOp[r.operation] = (row.tokensByOp[r.operation] ?? 0) + r.outputTokens;
    }
    return m;
  }, [usage?.byOperationDaily]);

  const paddedOutput = useMemo(() => {
    if (!usage) return [];
    return padDays(usage.days, usage.series, {
      outputTokens: 0,
      inputTokens: 0,
      totalTokens: 0,
      callCount: 0,
      failedCount: 0,
    });
  }, [usage]);

  const chart = useMemo(() => {
    const w = 640;
    const h = 200;
    const padL = 48;
    const padR = 16;
    const padT = 16;
    const padB = 36;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const n = paddedOutput.length;
    const maxTok = Math.max(1, ...paddedOutput.map((p) => p.outputTokens));
    const maxCalls = Math.max(1, ...paddedOutput.map((p) => p.callCount));

    const xAt = (i: number) =>
      n <= 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW;

    const tokPts = paddedOutput.map((p, i) => ({
      ...p,
      x: xAt(i),
      y: padT + innerH - (p.outputTokens / maxTok) * innerH,
    }));

    const callPts = paddedOutput.map((p, i) => ({
      ...p,
      x: xAt(i),
      y: padT + innerH - (p.callCount / maxCalls) * innerH * 0.85 + innerH * 0.08,
    }));

    const pathTok =
      tokPts.length === 0
        ? ''
        : tokPts.length === 1
          ? `M ${tokPts[0].x} ${tokPts[0].y}`
          : tokPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    const pathCalls =
      callPts.length === 0
        ? ''
        : callPts.length === 1
          ? `M ${callPts[0].x} ${callPts[0].y}`
          : callPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    return {
      w,
      h,
      padL,
      padT,
      innerW,
      innerH,
      tokPts,
      callPts,
      pathTok,
      pathCalls,
      maxTok,
      maxCalls,
      firstDay: paddedOutput[0]?.day ?? '',
      lastDay: paddedOutput[paddedOutput.length - 1]?.day ?? '',
    };
  }, [paddedOutput]);

  const nearestTokPoint = useMemo(() => {
    if (!chart.tokPts.length) return null;
    return (svgX: number) => {
      let best = 0;
      let bestD = Infinity;
      chart.tokPts.forEach((p, i) => {
        const d = Math.abs(p.x - svgX);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return chart.tokPts[best];
    };
  }, [chart.tokPts]);

  const handleSvgMouse = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const viewX =
      ((e.clientX - rect.left) / rect.width) * chart.w;
    if (!nearestTokPoint) {
      setHover(null);
      return;
    }
    const pt = nearestTokPoint(viewX);
    setHover({
      day: pt.day,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  const tooltipContent = useMemo(() => {
    if (!hover || !usage) return null;
    const day = hover.day;
    const row = paddedOutput.find((p) => p.day === day);
    const models = outputByDay.get(day) ?? {};
    const ops = opsByDay.get(day);
    const modelEntries = Object.entries(models).sort((a, b) => b[1] - a[1]);
    const callEntries = ops
      ? Object.entries(ops.callsByOp).sort((a, b) => b[1] - a[1])
      : [];

    return {
      day,
      totalOut: row?.outputTokens ?? 0,
      totalCalls: row?.callCount ?? 0,
      failed: row?.failedCount ?? 0,
      modelEntries,
      callEntries,
    };
  }, [hover, usage, paddedOutput, outputByDay, opsByDay]);

  const breakdownNote =
    usage?.breakdownRpcErrors?.model || usage?.breakdownRpcErrors?.operation
      ? 'Apply latest Supabase migration for per-model / per-route breakdown (fr94_llm_usage_by_*_daily).'
      : null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Usage (UTC days)</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Output tokens and LLM calls from <code className="text-[11px]">llm_call_logs</code>. Hover a point
            for totals, output tokens per model, and actions per route.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          Range
          <select
            value={usageDays}
            onChange={(e) => onChangeDays(Number(e.target.value))}
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
      {usageErr && <p className="mt-2 text-xs text-[var(--warn)]">{usageErr}</p>}
      {breakdownNote && (
        <p className="mt-2 text-xs text-[var(--warn)]">{breakdownNote}</p>
      )}
      {usage && (
        <>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
            <span>
              <span className="text-[var(--text)]">{usage.totals.outputTokens.toLocaleString()}</span> output
              tokens
            </span>
            <span>
              <span className="text-[var(--text)]">{usage.totals.callCount.toLocaleString()}</span> LLM calls
            </span>
            {usage.totals.failedCount > 0 ? (
              <span className="text-[var(--warn)]">{usage.totals.failedCount} failed</span>
            ) : null}
            {usage.cost ? (
              <>
                <span>
                  Est. spend ({usage.days}d):{' '}
                  <span className="text-[var(--text)]">{formatUsd(usage.cost.estimatedTotalUsd)}</span>
                </span>
                <span>
                  ~daily:{' '}
                  <span className="text-[var(--text)]">{formatUsd(usage.cost.estimatedDailyUsd)}</span>
                </span>
                <span>
                  ~weekly:{' '}
                  <span className="text-[var(--text)]">{formatUsd(usage.cost.estimatedWeeklyUsd)}</span>
                </span>
              </>
            ) : null}
          </div>
          {usage.cost?.unpricedModelCount ? (
            <p className="mt-1 text-[10px] text-[var(--warn)]">
              {usage.cost.unpricedModelCount} model(s) lack list prices — totals may be understated.
            </p>
          ) : null}
          {usage.cost?.note ? (
            <p className="mt-1 text-[10px] text-[var(--muted)]">{usage.cost.note}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm bg-[var(--accent)]" /> Output tokens
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm bg-[var(--good)]" /> LLM calls
            </span>
          </div>
          <div className="relative mt-2 overflow-x-auto">
            <svg
              width="100%"
              viewBox={`0 0 ${chart.w} ${chart.h}`}
              className="max-h-52 cursor-crosshair text-[var(--muted)]"
              role="img"
              aria-label="Output tokens and LLM calls per day"
              onMouseMove={handleSvgMouse}
              onMouseLeave={() => setHover(null)}
            >
              <rect width={chart.w} height={chart.h} fill="transparent" />
              <line
                x1={chart.padL}
                y1={chart.padT + chart.innerH}
                x2={chart.padL + chart.innerW}
                y2={chart.padT + chart.innerH}
                stroke="var(--border)"
                strokeWidth="1"
              />
              <text x={chart.padL} y={chart.h - 8} fontSize="10" fill="currentColor">
                {chart.firstDay}
              </text>
              <text
                x={chart.padL + chart.innerW}
                y={chart.h - 8}
                fontSize="10"
                fill="currentColor"
                textAnchor="end"
              >
                {chart.lastDay}
              </text>
              <text x={6} y={chart.padT + 12} fontSize="10" fill="currentColor">
                {chart.maxTok} tok
              </text>
              <text x={6} y={chart.padT + chart.innerH} fontSize="10" fill="var(--good)">
                {chart.maxCalls} calls
              </text>
              {chart.pathCalls ? (
                <path
                  d={chart.pathCalls}
                  fill="none"
                  stroke="var(--good)"
                  strokeWidth="1.5"
                  opacity={0.85}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {chart.pathTok ? (
                <path
                  d={chart.pathTok}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {chart.tokPts.map((p) => (
                <circle
                  key={p.day}
                  cx={p.x}
                  cy={p.y}
                  r={hover?.day === p.day ? 6 : 4}
                  fill="var(--accent)"
                  opacity={hover?.day === p.day ? 1 : 0.75}
                />
              ))}
            </svg>
            {tooltipContent && hover && (
              <div
                className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] shadow-lg"
                style={{
                  left: Math.min(window.innerWidth - 280, hover.clientX + 12),
                  top: Math.min(window.innerHeight - 200, hover.clientY + 12),
                }}
              >
                <div className="font-semibold text-[var(--text)]">{tooltipContent.day}</div>
                <div className="mt-1 text-[var(--muted)]">
                  Output tokens:{' '}
                  <span className="tabular-nums text-[var(--text)]">
                    {tooltipContent.totalOut.toLocaleString()}
                  </span>
                </div>
                <div className="text-[var(--muted)]">
                  LLM calls:{' '}
                  <span className="tabular-nums text-[var(--text)]">
                    {tooltipContent.totalCalls.toLocaleString()}
                  </span>
                  {tooltipContent.failed > 0 ? (
                    <span className="text-[var(--warn)]"> ({tooltipContent.failed} failed)</span>
                  ) : null}
                </div>
                {tooltipContent.modelEntries.length > 0 ? (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <div className="font-medium text-[var(--text)]">Output tokens by model</div>
                    <ul className="mt-1 max-h-28 overflow-y-auto">
                      {tooltipContent.modelEntries.map(([model, tok]) => (
                        <li key={model} className="flex justify-between gap-2">
                          <span className="truncate text-[var(--muted)]" title={model}>
                            {model}
                          </span>
                          <span className="shrink-0 tabular-nums text-[var(--text)]">
                            {tok.toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-2 text-[var(--muted)]">No per-model breakdown for this day.</div>
                )}
                {tooltipContent.callEntries.length > 0 ? (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <div className="font-medium text-[var(--text)]">Actions by route</div>
                    <ul className="mt-1 max-h-28 overflow-y-auto">
                      {tooltipContent.callEntries.map(([op, c]) => (
                        <li key={op} className="flex justify-between gap-2">
                          <span className="truncate text-[var(--muted)]" title={op}>
                            {operationChartLabel(op)}
                          </span>
                          <span className="shrink-0 tabular-nums text-[var(--text)]">{c} calls</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </section>
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
  const [telemetryRpcError, setTelemetryRpcError] = useState<string | null>(null);
  const [promptRows, setPromptRows] = useState<PromptRow[]>([]);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [promptSaving, setPromptSaving] = useState<Record<string, boolean>>({});
  const [promptErr, setPromptErr] = useState<string | null>(null);

  const [tab, setTab] = useState<'pipeline' | 'prompts' | 'models' | 'usage'>('pipeline');
  const [selectedPromptKey, setSelectedPromptKey] = useState<StablePromptKey>('context_user_voice');
  const [promptEditing, setPromptEditing] = useState(false);

  const [selectedRoute, setSelectedRoute] = useState<Fr94RouteOperation>('asset_analysis_image');
  const [modelEditing, setModelEditing] = useState(false);

  const [feedback, setFeedback] = useState<{ kind: 'good' | 'bad'; msg: string } | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const modelSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const r of routes) {
      s.add(r.effective.model);
      if (r.dbRow) s.add(r.dbRow.model);
    }
    return [...s].sort();
  }, [routes]);

  const selectedPromptRow = useMemo(
    () => promptRows.find((p) => p.key === selectedPromptKey),
    [promptRows, selectedPromptKey],
  );

  const promptKeysByGroup = useMemo(() => buildPromptKeysByGroup(), []);

  const selectedRoutePayload = useMemo(
    () => routes.find((r) => r.operation === selectedRoute),
    [routes, selectedRoute],
  );

  const loadSettings = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/content-review/llm-settings', { credentials: 'include' });
      const json = await readJsonResponse<SettingsResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setRoutes(json.routes);
      setHints(json.runtimeHints);
      setTelemetryRpcError(json.telemetryRpcError ?? null);
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
      const json = await readJsonResponse<
        UsageResponse & { error?: string; byModelDaily?: ModelDailyRow[]; byOperationDaily?: OperationDailyRow[] }
      >(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setUsage({
        ...json,
        byModelDaily: json.byModelDaily ?? [],
        byOperationDaily: json.byOperationDaily ?? [],
      });
    } catch (e) {
      setUsageErr(e instanceof Error ? e.message : String(e));
      setUsage(null);
    }
  }, []);

  const loadPrompts = useCallback(async () => {
    setPromptErr(null);
    try {
      const res = await fetch('/api/content-review/llm-prompts', { credentials: 'include' });
      const json = await readJsonResponse<PromptsResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      const list = json.prompts ?? [];
      setPromptRows(list);
      const d: Record<string, string> = {};
      for (const p of list) {
        d[p.key] = p.effectiveBody;
      }
      setPromptDrafts(d);
    } catch (e) {
      setPromptErr(e instanceof Error ? e.message : String(e));
      setPromptRows([]);
      setPromptDrafts({});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await Promise.all([loadSettings(), loadPrompts()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSettings, loadPrompts]);

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
        setModelEditing(false);
        setFeedback({ kind: 'good', msg: 'Model route saved.' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setFeedback({ kind: 'bad', msg });
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
        setModelEditing(false);
        setFeedback({ kind: 'good', msg: 'Model route reset to code defaults.' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setFeedback({ kind: 'bad', msg });
      } finally {
        setSaving((s) => ({ ...s, [operation]: false }));
      }
    },
    [loadSettings],
  );

  const savePrompt = useCallback(
    async (key: StablePromptKey) => {
      const body = promptDrafts[key]?.trim();
      if (!body) {
        setPromptErr('Prompt body cannot be empty.');
        return;
      }
      setPromptSaving((s) => ({ ...s, [key]: true }));
      try {
        const res = await fetch('/api/content-review/llm-prompts', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, body }),
        });
        const json = await readJsonResponse<{ error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        await loadPrompts();
        setPromptEditing(false);
        setFeedback({ kind: 'good', msg: 'Prompt saved to database.' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPromptErr(msg);
        setFeedback({ kind: 'bad', msg });
      } finally {
        setPromptSaving((s) => ({ ...s, [key]: false }));
      }
    },
    [promptDrafts, loadPrompts],
  );

  const resetPrompt = useCallback(
    async (key: StablePromptKey) => {
      setPromptSaving((s) => ({ ...s, [key]: true }));
      try {
        const res = await fetch(`/api/content-review/llm-prompts?key=${encodeURIComponent(key)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        const json = await readJsonResponse<{ error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        await loadPrompts();
        setPromptEditing(false);
        setFeedback({ kind: 'good', msg: 'Prompt reset to file default.' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPromptErr(msg);
        setFeedback({ kind: 'bad', msg });
      } finally {
        setPromptSaving((s) => ({ ...s, [key]: false }));
      }
    },
    [loadPrompts],
  );

  const cancelPromptEdit = useCallback(() => {
    if (!selectedPromptRow) return;
    setPromptDrafts((prev) => ({
      ...prev,
      [selectedPromptKey]: selectedPromptRow.effectiveBody,
    }));
    setPromptEditing(false);
    setPromptErr(null);
  }, [selectedPromptRow, selectedPromptKey]);

  const cancelModelEdit = useCallback(() => {
    if (!selectedRoutePayload) return;
    setDrafts((prev) => ({
      ...prev,
      [selectedRoute]: effectiveToDraft(selectedRoutePayload.effective),
    }));
    setModelEditing(false);
  }, [selectedRoute, selectedRoutePayload]);

  const promptText = promptDrafts[selectedPromptKey] ?? selectedPromptRow?.effectiveBody ?? '';
  const promptBusy = promptSaving[selectedPromptKey] === true;

  const syncPromptTextareaHeight = useCallback(() => {
    const el = promptTextareaRef.current;
    if (!el || typeof window === 'undefined') return;
    el.style.height = '0px';
    const scrollH = el.scrollHeight;
    const minPx = Math.round(window.innerHeight * 0.52);
    const maxPx = Math.round(window.innerHeight * 0.88);
    const next = Math.min(Math.max(scrollH + 16, minPx), maxPx);
    el.style.height = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    if (tab !== 'prompts') return;
    syncPromptTextareaHeight();
  }, [promptText, selectedPromptKey, promptEditing, tab, syncPromptTextareaHeight]);

  useEffect(() => {
    if (tab !== 'prompts') return;
    window.addEventListener('resize', syncPromptTextareaHeight);
    return () => window.removeEventListener('resize', syncPromptTextareaHeight);
  }, [tab, syncPromptTextareaHeight]);
  const routeDraft = selectedRoutePayload ? drafts[selectedRoute] : undefined;
  const routeBusy = saving[selectedRoute] === true;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
    }`;

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 lg:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <Link
            href="/content/review"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
          >
            Back to review
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold tracking-tight">Settings</h1>
            <p className="text-xs text-[var(--muted)]">Pipeline, LLM prompts, models, and usage</p>
          </div>
        </div>
        {feedback && (
          <div
            className={`mx-auto mt-3 max-w-4xl rounded-md border px-3 py-2 text-sm ${
              feedback.kind === 'good'
                ? 'border-[var(--good)] text-[var(--good)]'
                : 'border-[var(--bad)] text-[var(--bad)]'
            }`}
            role="status"
          >
            {feedback.msg}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 lg:px-6">
        <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1">
          <button type="button" onClick={() => setTab('pipeline')} className={tabClass(tab === 'pipeline')}>
            Pipeline
          </button>
          <button type="button" onClick={() => setTab('prompts')} className={tabClass(tab === 'prompts')}>
            Prompts
          </button>
          <button type="button" onClick={() => setTab('models')} className={tabClass(tab === 'models')}>
            Models
          </button>
          <button type="button" onClick={() => setTab('usage')} className={tabClass(tab === 'usage')}>
            Usage
          </button>
        </div>

        {tab === 'pipeline' && <PipelineSection onFeedback={setFeedback} />}

        {tab === 'usage' && (
          <>
            <UsageSection
              usageDays={usageDays}
              onChangeDays={setUsageDays}
              usage={usage}
              usageErr={usageErr}
            />
            {(hints ?? usage?.runtimeHints) && (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--text)]">Runtime</span>
                <span className="mx-2">·</span>
                Prompt{' '}
                <code className="text-[11px]">
                  {hints?.fr94PromptVersion ?? usage?.runtimeHints.fr94PromptVersion}
                </code>
                <span className="mx-2">·</span>
                Explicit cache{' '}
                {(hints?.geminiExplicitCaching ?? usage?.runtimeHints.geminiExplicitCaching) ? 'on' : 'off'}
                <span className="mx-2">·</span>
                LLM logging{' '}
                {(hints?.llmLoggingDisabled ?? usage?.runtimeHints.llmLoggingDisabled) ? 'disabled' : 'enabled'}
                <span className="mx-2">·</span>
                Prompt edits change cache-key fingerprints until Gemini caches refresh.
              </section>
            )}
          </>
        )}

        {(tab === 'prompts' || tab === 'models') && loading && (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        )}
        {(tab === 'prompts' || tab === 'models') && error && (
          <div className="rounded-xl border border-[var(--bad)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                setError(null);
                void Promise.all([loadSettings(), loadPrompts()]);
              }}
            >
              Retry
            </button>
          </div>
        )}

        {tab === 'prompts' && (
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--text)]">Pipeline map</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Each model route and the stable prompt key(s) it reads at runtime. Unwired routes have prompts
              ready but no caller yet.
            </p>
            <ul className="mt-3 space-y-2">
              {PIPELINE_STEPS.map((step) => (
                <li
                  key={step.operation}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--text)]">{step.title}</span>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                        step.wired
                          ? 'border-[var(--good)] text-[var(--good)]'
                          : 'border-[var(--warn)] text-[var(--warn)]'
                      }`}
                    >
                      {step.wired ? 'wired' : 'not wired'}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--muted)]">{step.operation}</span>
                  </div>
                  <p className="mt-1 text-[var(--muted)]">{step.hint}</p>
                  {step.promptKeys.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {step.promptKeys.map((k) => (
                        <span
                          key={k}
                          className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)]"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-[var(--muted)]">No stable prompts assigned yet.</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === 'prompts' && (
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-xs text-[var(--muted)]">
              Stable prompts live in <code className="text-[11px]">llm_stable_prompts</code> when saved; otherwise
              repo files. Select a prompt, review full text, then Edit to change.
            </p>
            {promptErr && (
              <p className="mt-2 text-xs text-[var(--bad)]">
                {promptErr}
                <button type="button" className="ml-2 underline" onClick={() => void loadPrompts()}>
                  Retry
                </button>
              </p>
            )}
            <label className="mt-4 block text-xs">
              <span className="text-[var(--muted)]">Prompt</span>
              <select
                value={selectedPromptKey}
                disabled={promptBusy || promptEditing}
                onChange={(e) => {
                  const k = e.target.value as StablePromptKey;
                  setSelectedPromptKey(k);
                  setPromptEditing(false);
                  setPromptErr(null);
                }}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-sm"
              >
                {PROMPT_GROUP_ORDER.map((group) => {
                  const keys = promptKeysByGroup[group];
                  if (keys.length === 0) return null;
                  return (
                    <optgroup key={group} label={PROMPT_GROUP_LABEL[group]}>
                      {keys.map((k) => (
                        <option key={k} value={k}>
                          {PROMPT_META_BY_KEY[k].title}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>

            {selectedPromptRow && (
              <>
                <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
                  <p className="text-[var(--muted)]">{PROMPT_META_BY_KEY[selectedPromptKey].hint}</p>
                  <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">
                    {selectedPromptKey} · file: {selectedPromptRow.fileBasename} ·{' '}
                    {selectedPromptRow.source === 'db' ? 'Database' : 'File default'}
                    {selectedPromptRow.updated_at
                      ? ` · updated ${new Date(selectedPromptRow.updated_at).toLocaleString()}`
                      : ''}
                  </p>
                  <p className="mt-2 text-[var(--muted)]">
                    Characters:{' '}
                    <span className="tabular-nums text-[var(--text)]">{promptText.length.toLocaleString()}</span>
                    {' · '}
                    Est. tokens (~÷4):{' '}
                    <span className="tabular-nums text-[var(--text)]">
                      {estimateTokensApprox(promptText.length).toLocaleString()}
                    </span>
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!promptEditing ? (
                    <button
                      type="button"
                      disabled={promptBusy}
                      onClick={() => setPromptEditing(true)}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={promptBusy}
                        onClick={() => void savePrompt(selectedPromptKey)}
                        className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {promptBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        disabled={promptBusy}
                        onClick={cancelPromptEdit}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={promptBusy || selectedPromptRow.source !== 'db'}
                    onClick={() => void resetPrompt(selectedPromptKey)}
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                  >
                    Reset to file default
                  </button>
                </div>

                <textarea
                  ref={promptTextareaRef}
                  value={promptText}
                  readOnly={!promptEditing}
                  disabled={promptBusy}
                  onChange={(e) =>
                    setPromptDrafts((prev) => ({ ...prev, [selectedPromptKey]: e.target.value }))
                  }
                  rows={3}
                  className={`mt-2 box-border w-full resize-y overflow-y-auto rounded-md border px-3 py-3 font-mono text-[13px] leading-relaxed text-[var(--text)] disabled:opacity-60 ${
                    promptEditing
                      ? 'border-[var(--accent)] bg-[var(--bg)]'
                      : 'cursor-default border-[var(--border)] bg-[var(--surface-2)]'
                  }`}
                  spellCheck={false}
                />
              </>
            )}
          </section>
        )}

        {tab === 'models' && (
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <datalist id="fr94-model-suggestions">
              {modelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Model route</span>
              <select
                value={selectedRoute}
                disabled={routeBusy || modelEditing}
                onChange={(e) => {
                  setSelectedRoute(e.target.value as Fr94RouteOperation);
                  setModelEditing(false);
                }}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-sm"
              >
                {ROUTE_ORDER.map((op) => (
                  <option key={op} value={op}>
                    {ROUTE_META[op].title}
                  </option>
                ))}
              </select>
            </label>

            {selectedRoutePayload && routeDraft && (
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold">{ROUTE_META[selectedRoute].title}</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">{ROUTE_META[selectedRoute].hint}</p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{selectedRoute}</p>
                  {selectedRoutePayload.dbRow?.updated_at && (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      DB updated {new Date(selectedRoutePayload.dbRow.updated_at).toLocaleString()}
                    </p>
                  )}
                  <RouteTelemetryPanel
                    telemetry={selectedRoutePayload.telemetry}
                    telemetryRpcError={telemetryRpcError}
                    model={selectedRoutePayload.effective.model}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs">
                    <span className="text-[var(--muted)]">Model</span>
                    <input
                      type="text"
                      list="fr94-model-suggestions"
                      readOnly={!modelEditing}
                      disabled={selectedRoutePayload.modelLockedByEnv || routeBusy}
                      value={routeDraft.model}
                      onChange={(e) => updateDraft(selectedRoute, { model: e.target.value })}
                      className={`mt-1 w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-sm disabled:opacity-60 ${
                        modelEditing ? 'bg-[var(--bg)]' : 'cursor-default bg-[var(--surface)]'
                      }`}
                    />
                    {selectedRoutePayload.modelLockedByEnv && (
                      <span className="mt-1 block text-[10px] text-[var(--warn)]">
                        Locked by{' '}
                        <code className="text-[10px]">FR94_MODEL_{selectedRoute.toUpperCase()}</code>
                      </span>
                    )}
                  </label>

                  <label className="block text-xs">
                    <span className="text-[var(--muted)]">
                      Temperature ({routeDraft.temperature.toFixed(2)})
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.01}
                      disabled={!modelEditing || routeBusy}
                      value={routeDraft.temperature}
                      onChange={(e) =>
                        updateDraft(selectedRoute, { temperature: Number.parseFloat(e.target.value) })
                      }
                      className="mt-2 w-full disabled:opacity-50"
                    />
                  </label>

                  <label className="block text-xs sm:col-span-2">
                    <span className="text-[var(--muted)]">Max output tokens</span>
                    <input
                      type="number"
                      min={1}
                      max={32768}
                      readOnly={!modelEditing}
                      disabled={routeBusy}
                      value={routeDraft.max_output_tokens}
                      onChange={(e) =>
                        updateDraft(selectedRoute, {
                          max_output_tokens: Number.parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className={`mt-1 w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-sm disabled:opacity-60 ${
                        modelEditing ? 'bg-[var(--bg)]' : 'cursor-default bg-[var(--surface)]'
                      }`}
                    />
                  </label>

                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      disabled={!modelEditing || routeBusy}
                      checked={routeDraft.use_cache}
                      onChange={(e) => updateDraft(selectedRoute, { use_cache: e.target.checked })}
                    />
                    Use explicit Gemini context cache when enabled globally
                  </label>

                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      disabled={!modelEditing || routeBusy}
                      checked={routeDraft.require_json}
                      onChange={(e) => updateDraft(selectedRoute, { require_json: e.target.checked })}
                    />
                    Require JSON response
                  </label>

                  <label className="block text-xs sm:col-span-2">
                    <span className="text-[var(--muted)]">Thinking level</span>
                    <select
                      disabled={!modelEditing || routeBusy}
                      value={routeDraft.thinking_level}
                      onChange={(e) =>
                        updateDraft(selectedRoute, { thinking_level: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm disabled:opacity-60"
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
                  {!modelEditing ? (
                    <button
                      type="button"
                      disabled={routeBusy}
                      onClick={() => setModelEditing(true)}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={routeBusy}
                        onClick={() => void saveRoute(selectedRoute)}
                        className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {routeBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        disabled={routeBusy}
                        onClick={cancelModelEdit}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={routeBusy || !selectedRoutePayload.dbRow}
                    onClick={() => void resetRoute(selectedRoute)}
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                  >
                    Reset to code defaults
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
