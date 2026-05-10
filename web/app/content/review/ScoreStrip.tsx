'use client';

import type { PostCandidate } from './types';

type ScoreDef = {
  key: keyof PostCandidate;
  label: string;
  valueClass: string;
};

const SCORES: ScoreDef[] = [
  { key: 'priority_score', label: 'Priority', valueClass: 'text-amber-400' },
  { key: 'mission_score', label: 'Mission', valueClass: 'text-emerald-400' },
  { key: 'human_score', label: 'Human', valueClass: 'text-sky-400' },
  { key: 'sponsor_safety_score', label: 'Sponsor', valueClass: 'text-violet-400' },
  { key: 'effort_score', label: 'Effort', valueClass: 'text-zinc-200' },
];

function formatScore(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(1);
}

export function ScoreStrip({ candidate }: { candidate: PostCandidate }) {
  const cells = SCORES.map((s) => ({
    label: s.label,
    valueClass: s.valueClass,
    value: formatScore(candidate[s.key]),
  })).filter((s) => s.value != null);

  if (cells.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-stretch gap-2">
      {cells.map((s) => (
        <div
          key={s.label}
          className="flex min-w-[68px] flex-col items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {s.label}
          </span>
          <span className={`text-xl font-semibold tabular-nums ${s.valueClass}`}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
