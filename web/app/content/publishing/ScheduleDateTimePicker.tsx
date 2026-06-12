'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  CALENDAR_WEEKDAY_LABELS,
  buildDatetimeLocalValue,
  calendarMonthCells,
  formatScheduleDateLabel,
  parseDatetimeLocalValue,
  startOfTodayLocal,
} from '@/lib/publishing-schedule-datetime';

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toTimeValue(hh: number, mm: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}`;
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IconClock({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

export function ScheduleDateTimePicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const parts = parseDatetimeLocalValue(value);
  const [viewYear, setViewYear] = useState(() => parts?.y ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (parts ? parts.m - 1 : new Date().getMonth()));
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (!parts) return;
    setViewYear(parts.y);
    setViewMonth(parts.m - 1);
  }, [value, parts?.y, parts?.m]);

  const today = useMemo(() => startOfTodayLocal(), []);
  const monthCells = useMemo(
    () => calendarMonthCells(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const monthLabel = useMemo(
    () =>
      new Date(viewYear, viewMonth, 1).toLocaleString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [viewYear, viewMonth],
  );

  const selectedDate = parts ? new Date(parts.y, parts.m - 1, parts.d) : null;
  const dateLabel = formatScheduleDateLabel(value);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const selectDay = (day: Date) => {
    const current = parts ?? {
      y: day.getFullYear(),
      m: day.getMonth() + 1,
      d: day.getDate(),
      hh: 12,
      mm: 0,
    };
    onChange(
      buildDatetimeLocalValue(
        day.getFullYear(),
        day.getMonth() + 1,
        day.getDate(),
        current.hh,
        current.mm,
      ),
    );
    setCalendarOpen(false);
  };

  const onTimeChange = (timeValue: string) => {
    const [hhRaw, mmRaw] = timeValue.split(':');
    const hh = Number(hhRaw);
    const mm = Number(mmRaw);
    if (!parts || !Number.isFinite(hh) || !Number.isFinite(mm)) return;
    onChange(buildDatetimeLocalValue(parts.y, parts.m, parts.d, hh, mm));
  };

  const cellClass = compact ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-sm';
  const navBtnClass = compact
    ? 'rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40'
    : 'rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40';
  const fieldShell = compact
    ? 'flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5'
    : 'flex items-center gap-2.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCalendarOpen((open) => !open)}
          aria-expanded={calendarOpen}
          aria-label="Choose publish date"
          className={`${fieldShell} min-w-0 flex-1 text-left transition-colors hover:border-[var(--accent)]/50 disabled:opacity-50`}
        >
          <IconCalendar className="shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{dateLabel}</span>
        </button>

        <div className={`${fieldShell} w-full shrink-0 sm:w-[7.25rem]`}>
          <IconClock className="shrink-0 text-[var(--accent)]" />
          <input
            id="schedule-time"
            type="time"
            disabled={disabled || !parts}
            value={parts ? toTimeValue(parts.hh, parts.mm) : ''}
            onChange={(e) => onTimeChange(e.target.value)}
            aria-label="Publish time"
            className="min-w-0 w-full border-0 bg-transparent text-sm text-[var(--text)] outline-none disabled:opacity-50"
          />
        </div>
      </div>

      {calendarOpen && (
        <div
          className={
            compact
              ? 'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2'
              : 'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3'
          }
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => shiftMonth(-1)}
              className={navBtnClass}
              aria-label="Previous month"
            >
              ←
            </button>
            <span className={compact ? 'text-[11px] font-semibold' : 'text-sm font-semibold'}>
              {monthLabel}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => shiftMonth(1)}
              className={navBtnClass}
              aria-label="Next month"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {CALENDAR_WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className={
                  compact
                    ? 'py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)]'
                    : 'py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]'
                }
              >
                {label}
              </div>
            ))}

            {monthCells.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className={cellClass} aria-hidden />;
              }

              const isPast = day.getTime() < today.getTime();
              const isSelected = selectedDate ? sameDay(day, selectedDate) : false;
              const isToday = sameDay(day, today);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={disabled || isPast}
                  onClick={() => selectDay(day)}
                  className={`${cellClass} rounded-md font-medium transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent)] text-black'
                      : isPast
                        ? 'cursor-not-allowed text-[var(--muted)]/40'
                        : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                  } ${isToday && !isSelected ? 'ring-1 ring-[var(--accent)]/60' : ''}`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
