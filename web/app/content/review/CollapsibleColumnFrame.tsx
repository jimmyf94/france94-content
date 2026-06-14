'use client';

import type { ReactNode } from 'react';

export const COLLAPSED_COLUMN_WIDTH = '44px';

export function columnGridWidth(collapsed: boolean, expanded: string): string {
  return collapsed ? COLLAPSED_COLUMN_WIDTH : expanded;
}

/** `end` = left-side panel (toggle top-right). `start` = right-side panel (toggle top-left). */
export type ColumnTogglePlacement = 'start' | 'end';

type CollapsibleColumnFrameProps = {
  label: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  badge?: string | number | null;
  borderSide?: 'left' | 'right' | 'both' | 'none';
  className?: string;
  togglePlacement?: ColumnTogglePlacement;
  hideHeaderWhenExpanded?: boolean;
  children?: ReactNode;
};

function borderClass(side: CollapsibleColumnFrameProps['borderSide']): string {
  switch (side) {
    case 'left':
      return 'border-l border-[var(--border)]';
    case 'both':
      return 'border-x border-[var(--border)]';
    case 'none':
      return '';
    case 'right':
    default:
      return 'border-r border-[var(--border)]';
  }
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {direction === 'left' ? <path d="M10 3.5 5.5 8 10 12.5" /> : <path d="M6 3.5 10.5 8 6 12.5" />}
    </svg>
  );
}

/** Left panel: close ←, open →. Right panel: close →, open ←. */
export function columnToggleChevron(
  placement: ColumnTogglePlacement,
  collapsed: boolean,
): 'left' | 'right' {
  if (placement === 'end') {
    return collapsed ? 'right' : 'left';
  }
  return collapsed ? 'left' : 'right';
}

export const COLUMN_TOGGLE_CLASS =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)]/95 text-[var(--muted)] shadow-sm backdrop-blur-sm transition-all hover:border-[var(--accent)]/40 hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] active:scale-[0.97]';

const COLUMN_RAIL_TOGGLE_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/80 text-[var(--muted)] shadow-sm transition-all hover:border-[var(--accent)]/45 hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] active:scale-[0.97]';

export function ColumnPanelToggle({
  label,
  collapsed,
  placement,
  onClick,
  className = '',
}: {
  label: string;
  collapsed: boolean;
  placement: ColumnTogglePlacement;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${COLUMN_TOGGLE_CLASS} ${className}`}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-expanded={!collapsed}
    >
      <ChevronIcon direction={columnToggleChevron(placement, collapsed)} />
    </button>
  );
}

function ColumnRailBadge({ badge }: { badge: string | number }) {
  return (
    <span className="mt-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-[var(--text)]">
      {badge}
    </span>
  );
}

function ColumnToggleChrome({
  label,
  collapsed,
  placement,
  onToggleCollapsed,
}: {
  label: string;
  collapsed: boolean;
  placement: ColumnTogglePlacement;
  onToggleCollapsed: () => void;
}) {
  return (
    <div
      className={`flex shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 ${
        placement === 'start' ? 'justify-start' : 'justify-end'
      }`}
    >
      <ColumnPanelToggle
        label={label}
        collapsed={collapsed}
        placement={placement}
        onClick={onToggleCollapsed}
      />
    </div>
  );
}

export function CollapsibleColumnFrame({
  label,
  collapsed,
  onToggleCollapsed,
  badge,
  borderSide = 'right',
  className = '',
  togglePlacement = 'end',
  hideHeaderWhenExpanded = false,
  children,
}: CollapsibleColumnFrameProps) {
  const border = borderClass(borderSide);

  if (collapsed) {
    return (
      <div
        className={`flex min-h-0 min-w-0 flex-col items-center bg-[var(--surface)] ${border} ${className}`}
      >
        <div className="flex w-full flex-col items-center gap-3 px-1 py-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={COLUMN_RAIL_TOGGLE_CLASS}
            title={`Expand ${label}`}
            aria-label={`Expand ${label}`}
            aria-expanded={false}
          >
            <ChevronIcon direction={columnToggleChevron(togglePlacement, true)} />
          </button>
          <span
            className="select-none text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)] [writing-mode:vertical-rl] rotate-180"
            aria-hidden
          >
            {label}
          </span>
          {badge != null && badge !== '' ? <ColumnRailBadge badge={badge} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex min-h-0 min-w-0 flex-col ${border} ${className}`}>
      {hideHeaderWhenExpanded ? (
        <ColumnToggleChrome
          label={label}
          collapsed={false}
          placement={togglePlacement}
          onToggleCollapsed={onToggleCollapsed}
        />
      ) : (
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 ${
            togglePlacement === 'start' ? 'justify-start' : 'justify-between'
          }`}
        >
          {togglePlacement === 'start' ? (
            <>
              <ColumnPanelToggle
                label={label}
                collapsed={false}
                placement={togglePlacement}
                onClick={onToggleCollapsed}
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  {label}
                </span>
                {badge != null && badge !== '' ? (
                  <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-[var(--text)]">
                    {badge}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
                  {label}
                </span>
                {badge != null && badge !== '' ? (
                  <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-[var(--text)]">
                    {badge}
                  </span>
                ) : null}
              </div>
              <ColumnPanelToggle
                label={label}
                collapsed={false}
                placement={togglePlacement}
                onClick={onToggleCollapsed}
              />
            </>
          )}
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
