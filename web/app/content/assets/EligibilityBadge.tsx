import type { AssetEligibility } from '@/lib/asset-library-types';

const STYLES: Record<string, string> = {
  eligible: 'border-emerald-600/40 bg-emerald-950/30 text-emerald-200',
  excluded: 'border-rose-600/40 bg-rose-950/30 text-rose-200',
  stale: 'border-amber-600/40 bg-amber-950/30 text-amber-200',
  manual_only: 'border-sky-600/40 bg-sky-950/30 text-sky-200',
  needs_review: 'border-violet-600/40 bg-violet-950/30 text-violet-200',
};

export function EligibilityBadge({ value }: { value: string | null | undefined }) {
  const v = (value ?? 'eligible').trim() as AssetEligibility | string;
  const cls = STYLES[v] ?? 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]';
  return (
    <span
      className={`inline-flex max-w-full truncate rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {v.replace(/_/g, ' ')}
    </span>
  );
}
