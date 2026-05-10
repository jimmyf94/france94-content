'use client';

type Shortcut = { keys: string[]; label: string };

const SHORTCUTS: Shortcut[] = [
  { keys: ['A'], label: 'Approve' },
  { keys: ['W'], label: 'Needs rewrite' },
  { keys: ['R'], label: 'Reject' },
  { keys: ['J', 'K'], label: 'Next / Prev' },
  { keys: ['Space'], label: 'Play / Pause' },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--text)] shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]">
      {children}
    </kbd>
  );
}

export function ShortcutsBanner() {
  return (
    <footer className="hidden shrink-0 items-center justify-center gap-5 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs text-[var(--muted)] lg:flex">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Shortcuts
      </span>
      {SHORTCUTS.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {s.keys.map((k, i) => (
              <span key={k} className="flex items-center gap-0.5">
                {i > 0 && <span className="text-[var(--muted)]">/</span>}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </span>
          <span>{s.label}</span>
        </span>
      ))}
    </footer>
  );
}
