import type { PublishingQueueItem } from '@/lib/publishing-types';
import { startOfTodayLocal } from '@/lib/publishing-schedule-datetime';

export function isScheduledPublishingItem(item: PublishingQueueItem): boolean {
  return item.status === 'scheduled' && Boolean(item.scheduled_publish_at);
}

export function splitPublishingQueueItems(items: PublishingQueueItem[]): {
  scheduled: PublishingQueueItem[];
  unscheduled: PublishingQueueItem[];
} {
  const scheduled: PublishingQueueItem[] = [];
  const unscheduled: PublishingQueueItem[] = [];

  for (const item of items) {
    if (isScheduledPublishingItem(item)) {
      scheduled.push(item);
    } else {
      unscheduled.push(item);
    }
  }

  scheduled.sort((a, b) => {
    const ta = Date.parse(a.scheduled_publish_at ?? '');
    const tb = Date.parse(b.scheduled_publish_at ?? '');
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  return { scheduled, unscheduled };
}

export function scheduledItemsForDay(
  items: PublishingQueueItem[],
  day: Date,
): PublishingQueueItem[] {
  return items.filter((item) => {
    if (!item.scheduled_publish_at) return false;
    const when = new Date(item.scheduled_publish_at);
    return (
      when.getFullYear() === day.getFullYear() &&
      when.getMonth() === day.getMonth() &&
      when.getDate() === day.getDate()
    );
  });
}

export function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export type ScheduledDayGroup = {
  dayKey: string;
  label: string;
  items: PublishingQueueItem[];
};

function formatAgendaDayLabel(day: Date, today: Date): string {
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (
    day.getFullYear() === today.getFullYear() &&
    day.getMonth() === today.getMonth() &&
    day.getDate() === today.getDate()
  ) {
    return 'Today';
  }
  if (
    day.getFullYear() === tomorrow.getFullYear() &&
    day.getMonth() === tomorrow.getMonth() &&
    day.getDate() === tomorrow.getDate()
  ) {
    return 'Tomorrow';
  }
  return day.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** Group scheduled items by local calendar day for mobile agenda views. */
export function groupScheduledByDay(
  items: PublishingQueueItem[],
  today = startOfTodayLocal(),
): ScheduledDayGroup[] {
  const byDay = new Map<string, PublishingQueueItem[]>();

  for (const item of items) {
    if (!item.scheduled_publish_at) continue;
    const when = new Date(item.scheduled_publish_at);
    if (!Number.isFinite(when.getTime())) continue;
    const dayKey = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
    const bucket = byDay.get(dayKey);
    if (bucket) bucket.push(item);
    else byDay.set(dayKey, [item]);
  }

  const groups: ScheduledDayGroup[] = [];
  for (const [, dayItems] of byDay) {
    const first = dayItems[0]?.scheduled_publish_at;
    if (!first) continue;
    const when = new Date(first);
    groups.push({
      dayKey: `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`,
      label: formatAgendaDayLabel(when, today),
      items: [...dayItems].sort((a, b) => {
        const ta = Date.parse(a.scheduled_publish_at ?? '');
        const tb = Date.parse(b.scheduled_publish_at ?? '');
        return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
      }),
    });
  }

  groups.sort((a, b) => {
    const ta = Date.parse(a.items[0]?.scheduled_publish_at ?? '');
    const tb = Date.parse(b.items[0]?.scheduled_publish_at ?? '');
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  return groups;
}
