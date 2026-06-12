'use client';

import {
  formatDurationShort,
  parseRenderProgress,
} from '@fr94/reel-render-progress';

type ReelRenderProgressProps = {
  jobStatus: string;
  renderLog: Record<string, unknown> | null;
  jobUpdatedAt?: string | null;
};

export function ReelRenderProgress({ jobStatus, renderLog, jobUpdatedAt }: ReelRenderProgressProps) {
  const p = parseRenderProgress(renderLog, jobStatus, jobUpdatedAt);

  const secondaryParts: string[] = [`${p.progressPct}%`];
  const eta = formatDurationShort(p.etaSeconds);
  if (eta) secondaryParts.push(`~${eta} remaining`);
  const elapsed = formatDurationShort(p.elapsedSeconds);
  if (elapsed) secondaryParts.push(`${elapsed} elapsed`);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[var(--text)]">{p.message}</p>
        {!p.isIndeterminate && <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">{p.progressPct}%</span>}
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface)]">
        {p.isIndeterminate ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--accent)]/70" />
        ) : (
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(p.progressPct, p.progressPct > 0 ? 4 : 0)}%` }}
          />
        )}
      </div>

      <p className="mt-2 text-[10px] text-[var(--muted)]">{secondaryParts.join(' · ')}</p>

      {p.showStuckHint && (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--muted)]">
          Still waiting for the local render worker. Ensure{' '}
          <code className="rounded bg-[var(--surface)] px-1 py-0.5">npm run review:dev</code> is running,
          or run{' '}
          <code className="rounded bg-[var(--surface)] px-1 py-0.5">npm run render:reels</code> manually.
        </p>
      )}
    </div>
  );
}
