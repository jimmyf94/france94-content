'use client';

const CHIPS = [
  'Too generic',
  'More raw',
  'Less corporate',
  'Shorter',
  'French first',
  'Bad hook',
] as const;

export function RewriteChips({ onAppend }: { onAppend: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CHIPS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onAppend(c)}
          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--warn)] hover:text-[var(--warn)]"
        >
          + {c}
        </button>
      ))}
    </div>
  );
}
