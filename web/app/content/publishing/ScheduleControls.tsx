'use client';

import { useEffect, useState } from 'react';

import {
  defaultScheduleDatetimeLocal,
  isDatetimeLocalInFuture,
  isoToDatetimeLocalValue,
} from '@/lib/publishing-schedule-datetime';

import { ScheduleDateTimePicker } from './ScheduleDateTimePicker';

export function ScheduleControls({
  scheduledAt,
  canSetSchedule,
  canUnschedule,
  canPublishNow,
  acting,
  compact = false,
  layout = 'stack',
  onSchedule,
  onUnschedule,
  onPublishNow,
}: {
  scheduledAt: string | null | undefined;
  canSetSchedule: boolean;
  canUnschedule: boolean;
  canPublishNow: boolean;
  acting: boolean;
  compact?: boolean;
  layout?: 'stack' | 'queue';
  onSchedule: (iso: string) => void | Promise<void>;
  onUnschedule: () => void | Promise<void>;
  onPublishNow: () => void | Promise<void>;
}) {
  const [localDt, setLocalDt] = useState('');

  useEffect(() => {
    setLocalDt(
      scheduledAt ? isoToDatetimeLocalValue(scheduledAt) : defaultScheduleDatetimeLocal(),
    );
  }, [scheduledAt]);

  const savedLocal = scheduledAt ? isoToDatetimeLocalValue(scheduledAt) : '';
  const isFuture = isDatetimeLocalInFuture(localDt);
  const scheduleEdited = localDt !== savedLocal;
  const canSave = Boolean(localDt.trim()) && scheduleEdited && isFuture;
  const showPastScheduleError = Boolean(localDt.trim()) && scheduleEdited && !isFuture;
  const isQueue = layout === 'queue';

  const btnPrimary = compact
    ? 'shrink-0 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-black hover:opacity-90 disabled:opacity-50'
    : 'rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50';

  const btnCancel = compact
    ? 'shrink-0 rounded-md border border-[var(--bad)]/50 px-2.5 py-1.5 text-[11px] font-medium text-[var(--bad)] hover:bg-[var(--bad)]/10 disabled:opacity-50'
    : 'rounded-md border border-[var(--bad)]/50 px-3 py-2 text-sm font-medium text-[var(--bad)] hover:bg-[var(--bad)]/10 disabled:opacity-50';

  const btnPublish = compact
    ? 'rounded-md border border-[var(--good)] bg-[var(--good)] px-2.5 py-1.5 text-[11px] font-semibold text-black hover:opacity-90 disabled:opacity-50'
    : 'rounded-md border border-[var(--good)] bg-[var(--good)] px-3 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50';

  const confirmSchedule = () => {
    if (!localDt.trim() || !isFuture) return;
    const ms = new Date(localDt).getTime();
    if (!Number.isFinite(ms)) return;
    void onSchedule(new Date(ms).toISOString());
  };

  if (!canSetSchedule && !canUnschedule && !canPublishNow) return null;

  const showActions = canSetSchedule || canUnschedule || canPublishNow;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {canSetSchedule && (
        <div className="space-y-2">
          {!isQueue && (
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Publish at
            </label>
          )}

          <ScheduleDateTimePicker
            value={localDt}
            onChange={setLocalDt}
            disabled={acting}
            compact={compact}
          />

          {showPastScheduleError && (
            <p className="text-[11px] text-[var(--bad)]">Pick a date and time in the future.</p>
          )}
        </div>
      )}

      {showActions && (
        <div className="flex flex-wrap items-stretch gap-2">
          {canSetSchedule && (
            <button
              type="button"
              disabled={acting || !canSave}
              onClick={confirmSchedule}
              className={`${btnPrimary} min-w-0 flex-1`}
            >
              {scheduledAt ? 'Update schedule' : 'Set schedule'}
            </button>
          )}
          {canUnschedule && (
            <button
              type="button"
              disabled={acting}
              onClick={() => void onUnschedule()}
              className={btnCancel}
            >
              Cancel schedule
            </button>
          )}
          {canPublishNow && (
            <button
              type="button"
              disabled={acting}
              onClick={() => {
                if (!window.confirm('Publish this post to Instagram now?')) return;
                void onPublishNow();
              }}
              className={`${btnPublish} min-w-0 flex-1`}
            >
              Publish now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
