'use client';

import type { DecisionStatus } from '../types';

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ShortcutKbd({
  children,
  tone,
}: {
  children: string;
  tone: 'dark' | 'warn' | 'bad';
}) {
  const cls =
    tone === 'dark'
      ? 'border-black/25 bg-black/10 text-black/80'
      : tone === 'warn'
        ? 'border-[var(--warn)]/35 bg-[var(--warn)]/10 text-[var(--warn)]'
        : 'border-[var(--bad)]/35 bg-[var(--bad)]/10 text-[var(--bad)]';
  return (
    <kbd
      className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${cls}`}
    >
      {children}
    </kbd>
  );
}

export function DecisionButtons({
  onDecide,
  disabled,
  approveDisabled,
  allDecisionsDisabled,
  size = 'md',
  layout = 'row',
  variant = 'default',
  showShortcuts = true,
}: {
  onDecide: (s: DecisionStatus) => void;
  disabled?: boolean;
  /** When true, Approve is disabled but rewrite/reject may still work. */
  approveDisabled?: boolean;
  /** When true, all three decision buttons are disabled (e.g. invalidated candidate). */
  allDecisionsDisabled?: boolean;
  size?: 'md' | 'lg';
  layout?: 'row' | 'column';
  variant?: 'default' | 'iconOnly';
  showShortcuts?: boolean;
}) {
  const padY = size === 'lg' ? 'py-3' : 'py-2.5';
  const iconOnly = variant === 'iconOnly';
  const containerCls = iconOnly
    ? 'flex gap-2'
    : layout === 'column'
      ? 'flex flex-col gap-2'
      : 'grid grid-cols-3 gap-2';
  const btnCls = !iconOnly && layout === 'column' ? 'w-full' : '';

  const allOff = Boolean(disabled || allDecisionsDisabled);

  const items: {
    status: DecisionStatus;
    label: string;
    shortcut: string;
    icon: React.ReactNode;
    buttonClass: string;
    kbdTone: 'dark' | 'warn' | 'bad';
  }[] = [
    {
      status: 'approved',
      label: 'Approve',
      shortcut: 'A',
      icon: <IconCheck className="shrink-0 opacity-90" />,
      buttonClass: iconOnly
        ? `rounded-md border border-[var(--good)] bg-[var(--good)] ${padY} px-3 text-black transition-[filter] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100`
        : `rounded-md bg-[var(--good)] ${padY} ${btnCls} text-sm font-semibold text-black transition-[background-color,filter] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100`,
      kbdTone: 'dark',
    },
    {
      status: 'needs_rewrite',
      label: 'Needs rewrite',
      shortcut: 'W',
      icon: <IconPencil className="shrink-0 opacity-90" />,
      buttonClass: iconOnly
        ? `rounded-md border border-[var(--warn)] bg-[var(--warn)] ${padY} px-3 text-black transition-[filter] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100`
        : `rounded-md border border-[var(--warn)] bg-transparent ${padY} ${btnCls} text-sm font-semibold text-[var(--warn)] transition-colors hover:bg-[var(--warn)]/15 disabled:opacity-50 disabled:hover:bg-transparent`,
      kbdTone: 'warn',
    },
    {
      status: 'rejected',
      label: 'Reject',
      shortcut: 'R',
      icon: <IconX className="shrink-0 opacity-90" />,
      buttonClass: iconOnly
        ? `rounded-md border border-[var(--bad)] bg-[var(--surface-2)] ${padY} px-3 text-[var(--bad)] transition-colors hover:bg-[var(--bad)]/10 disabled:opacity-50 disabled:hover:bg-[var(--surface-2)]`
        : `rounded-md border border-[var(--bad)] bg-transparent ${padY} ${btnCls} text-sm font-semibold text-[var(--bad)] transition-colors hover:bg-[var(--bad)]/15 disabled:opacity-50 disabled:hover:bg-transparent`,
      kbdTone: 'bad',
    },
  ];

  if (iconOnly) {
    return (
      <div className={containerCls}>
        {items.map((item) => (
          <button
            key={item.status}
            type="button"
            disabled={allOff || (item.status === 'approved' && approveDisabled)}
            onClick={() => onDecide(item.status)}
            aria-label={item.label}
            title={item.label}
            className={`flex items-center justify-center ${item.buttonClass}`}
          >
            {item.icon}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={containerCls}>
      {items.map((item) => (
        <button
          key={item.status}
          type="button"
          disabled={allOff || (item.status === 'approved' && approveDisabled)}
          onClick={() => onDecide(item.status)}
          className={`flex items-center justify-between gap-3 px-3 text-left ${item.buttonClass}`}
        >
          <span className="flex min-w-0 flex-1 items-center justify-start gap-2.5">
            {item.icon}
            <span className="min-w-0 truncate">{item.label}</span>
          </span>
          {showShortcuts ? (
            <ShortcutKbd tone={item.kbdTone}>{item.shortcut}</ShortcutKbd>
          ) : null}
        </button>
      ))}
    </div>
  );
}
