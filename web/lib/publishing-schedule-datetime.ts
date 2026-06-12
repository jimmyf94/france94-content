/** Value for `<input type="datetime-local" />` from an ISO timestamp. */
export function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type DatetimeLocalParts = {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
};

export function parseDatetimeLocalValue(value: string): DatetimeLocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const hh = Number(match[4]);
  const mm = Number(match[5]);
  if (!Number.isFinite(y + m + d + hh + mm)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
  return { y, m, d, hh, mm };
}

export function buildDatetimeLocalValue(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
}

export function formatScheduleLabel(localDt: string): string {
  const parts = parseDatetimeLocalValue(localDt);
  if (!parts) return '';
  const date = new Date(parts.y, parts.m - 1, parts.d, parts.hh, parts.mm);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatScheduleDateLabel(localDt: string): string {
  const parts = parseDatetimeLocalValue(localDt);
  if (!parts) return 'Select date';
  const date = new Date(parts.y, parts.m - 1, parts.d);
  if (!Number.isFinite(date.getTime())) return 'Select date';
  return date.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function isDatetimeLocalInFuture(value: string): boolean {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

export function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Monday-first weekday labels for calendar headers. */
export const CALENDAR_WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function calendarMonthCells(year: number, monthIndex: number): (Date | null)[] {
  const first = new Date(year, monthIndex, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: startPad }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, monthIndex, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Suggested default for a new schedule: next whole hour at least 1h from now. */
export function defaultScheduleDatetimeLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  if (d.getTime() <= Date.now()) {
    d.setHours(d.getHours() + 1);
  }
  return isoToDatetimeLocalValue(d.toISOString());
}
