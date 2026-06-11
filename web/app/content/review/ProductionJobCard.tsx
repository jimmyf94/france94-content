'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate, ReelReasoning, ReelVariantKind } from './types';
import { REEL_VARIANT_KINDS, REEL_VARIANT_LABELS } from './types';

type ProductionJobDto = {
  id: string;
  status: string;
  production_type: string;
  output_video_url: string | null;
  thumbnail_url: string | null;
  error_message: string | null;
  render_strategy: string | null;
  render_log: Record<string, unknown> | null;
  reel_specification: ReelSpecDto | null;
  updated_at: string | null;
};

type ReelSpecDto = {
  version?: string;
  clips?: Array<{
    clip_id: string;
    asset_id?: string;
    start_sec: number;
    end_sec: number;
    why?: string;
  }>;
  overlay_lines?: string[];
  total_duration_sec?: number;
};

const POLL_MS = 8000;

function parseReelSpec(raw: unknown): ReelSpecDto | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as ReelSpecDto;
}

function parseReasoning(raw: unknown): ReelReasoning | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as ReelReasoning;
}

function statusTone(status: string): string {
  if (status === 'produced') return 'text-emerald-400';
  if (status === 'failed' || status === 'needs_manual_production') return 'text-[var(--bad)]';
  if (status === 'rendering' || status === 'queued') return 'text-amber-300';
  return 'text-[var(--text)]';
}

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  return `${sec.toFixed(1)}s`;
}

export function ProductionJobCard({
  candidate,
  onVariantCreated,
}: {
  candidate: PostCandidate;
  onVariantCreated?: (c: PostCandidate) => void;
}) {
  const [job, setJob] = useState<ProductionJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantBusy, setVariantBusy] = useState<ReelVariantKind | null>(null);

  const reelSpec = useMemo(
    () => parseReelSpec(candidate.reel_instructions) ?? parseReelSpec(job?.reel_specification),
    [candidate.reel_instructions, job?.reel_specification],
  );

  const reasoning = useMemo(() => parseReasoning(candidate.reel_reasoning), [candidate.reel_reasoning]);

  const isClipReel = reelSpec?.version === 'clips-v1' && (reelSpec.clips?.length ?? 0) > 0;

  const hookText =
    reelSpec?.overlay_lines?.[0]?.trim() ||
    candidate.title_overlay?.trim() ||
    candidate.hook?.trim() ||
    null;

  const durationSec = useMemo(() => {
    if (reelSpec?.total_duration_sec != null) return reelSpec.total_duration_sec;
    const logDur = Number(job?.render_log?.duration_seconds);
    if (Number.isFinite(logDur)) return logDur;
    return null;
  }, [reelSpec, job?.render_log]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/production-jobs/by-candidate/${encodeURIComponent(candidate.id)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (res.status === 404) {
        setJob(null);
        return;
      }
      const json = await readJsonResponse<{ job?: ProductionJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setJob(json.job ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [candidate.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const status = job?.status ?? '';
    if (status !== 'queued' && status !== 'rendering') return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [job?.status, load]);

  const createVariant = useCallback(
    async (kind: ReelVariantKind) => {
      if (variantBusy) return;
      setVariantBusy(kind);
      setError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/variant`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind }),
        });
        const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
        if (!res.ok || !json.candidate) {
          throw new Error(json.error || res.statusText);
        }
        onVariantCreated?.(json.candidate);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setVariantBusy(null);
      }
    },
    [candidate.id, onVariantCreated, variantBusy],
  );

  if (candidate.post_type !== 'reel') return null;

  const previewUrl =
    job?.status === 'produced' && job.output_video_url
      ? job.output_video_url
      : null;
  const posterUrl = job?.thumbnail_url ?? candidate.cover_thumbnail_url ?? null;

  const reasoningEntries: Array<[string, string | undefined]> = [
    ['Why the script works', reasoning?.why_script_works],
    ['Why clips support it', reasoning?.why_clips_support_script],
    ['Emotional contrast', reasoning?.emotional_contrast],
    ['Scroll-stop', reasoning?.scroll_stop],
    ['Series fit', reasoning?.series_fit],
    ['Vs alternatives', reasoning?.clips_vs_alternatives],
  ].filter(([, v]) => typeof v === 'string' && v.trim().length > 0) as Array<[string, string]>;

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Reel preview
          </h3>
          {candidate.variant_kind && (
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
              Variant · {REEL_VARIANT_LABELS[candidate.variant_kind as ReelVariantKind] ?? candidate.variant_kind}
              {candidate.variant_of ? ` · of ${candidate.variant_of.slice(0, 8)}…` : ''}
            </p>
          )}
        </div>
        {candidate.selected_series && (
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--text)]">
            {candidate.selected_series}
          </span>
        )}
      </div>

      {hookText && (
        <p className="mt-2 text-sm font-medium leading-snug text-[var(--text)]">{hookText}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
        {formatDuration(durationSec) && <span>Duration {formatDuration(durationSec)}</span>}
        {reelSpec?.clips && <span>{reelSpec.clips.length} clip(s)</span>}
        {candidate.selected_clip_ids?.length ? (
          <span>{candidate.selected_clip_ids.length} tagged clip id(s)</span>
        ) : null}
      </div>

      {loading && !job && <p className="mt-2 text-xs text-[var(--muted)]">Loading render job…</p>}
      {error && <p className="mt-2 text-xs text-[var(--bad)] whitespace-pre-wrap">{error}</p>}

      {!loading && !job && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Render queued — the worker picks this up automatically (cron every ~10 min, or{' '}
          <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[10px]">npm run render:reels</code>
          ).
        </p>
      )}

      {job && (
        <div className="mt-3 space-y-3">
          <p className="text-xs">
            <span className="text-[var(--muted)]">Render:</span>{' '}
            <span className={`font-medium ${statusTone(job.status)}`}>{job.status}</span>
            {job.render_strategy ? (
              <>
                {' '}
                <span className="text-[var(--muted)]">·</span> {job.render_strategy}
              </>
            ) : null}
          </p>
          {job.error_message && (
            <p className="text-xs text-[var(--bad)] whitespace-pre-wrap">{job.error_message}</p>
          )}

          {(previewUrl || posterUrl) && (
            <div>
              {previewUrl ? (
                <video
                  key={previewUrl}
                  src={previewUrl}
                  poster={posterUrl ?? undefined}
                  controls
                  playsInline
                  className="mt-1 max-h-80 w-full max-w-sm rounded-md border border-[var(--border)] bg-black"
                />
              ) : posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={posterUrl}
                  alt="Reel thumbnail"
                  className="mt-1 max-h-48 w-full max-w-sm rounded-md border border-[var(--border)] object-cover"
                />
              ) : null}
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-[var(--accent)] underline hover:opacity-80"
                >
                  Open rendered MP4
                </a>
              )}
            </div>
          )}

          {reelSpec?.clips && reelSpec.clips.length > 0 && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Clips
              </p>
              <ul className="mt-1 space-y-1 text-xs text-[var(--text)]">
                {reelSpec.clips.map((c, i) => (
                  <li key={c.clip_id ?? i}>
                    <span className="text-[var(--muted)]">#{i + 1}</span>{' '}
                    {(c.end_sec - c.start_sec).toFixed(1)}s
                    {c.why ? <span className="text-[var(--muted)]"> — {c.why}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {reasoningEntries.length > 0 && (
            <details className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Assembly reasoning
              </summary>
              <dl className="mt-2 space-y-2 text-xs">
                {reasoningEntries.map(([label, text]) => (
                  <div key={label}>
                    <dt className="font-medium text-[var(--text)]">{label}</dt>
                    <dd className="mt-0.5 leading-relaxed text-[var(--muted)]">{text}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      )}

      {isClipReel && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Render variant
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Reuses pre-tagged clips — no re-analysis. Creates a new candidate and queues a render.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REEL_VARIANT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={!!variantBusy}
                onClick={() => void createVariant(kind)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                {variantBusy === kind ? 'Creating…' : REEL_VARIANT_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
