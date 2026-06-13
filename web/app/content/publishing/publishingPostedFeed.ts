import type { FeedbackPostRow } from '@/lib/feedback-types';
import { startOfTodayLocal } from '@/lib/publishing-schedule-datetime';

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parsePostedAt(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysBefore(from: Date, earlier: Date): number {
  const ms = startOfLocalDay(from).getTime() - startOfLocalDay(earlier).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function startOfWeekMonday(day: Date): Date {
  const d = startOfLocalDay(day);
  const dow = d.getDay();
  const sinceMonday = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - sinceMonday);
  return d;
}

export type PostedTimeGroup = {
  key: string;
  label: string;
  posts: FeedbackPostRow[];
};

const GROUP_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  'this-week': 'This week',
  'last-week': 'Last week',
  'earlier-this-month': 'Earlier this month',
};

function postedTimeGroupKey(postDay: Date, today: Date): string {
  const daysAgo = daysBefore(today, postDay);
  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';

  const thisWeekStart = startOfWeekMonday(today);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);

  if (postDay >= thisWeekStart && daysAgo >= 2) return 'this-week';
  if (postDay >= lastWeekStart && postDay <= lastWeekEnd) return 'last-week';

  if (
    postDay.getMonth() === today.getMonth() &&
    postDay.getFullYear() === today.getFullYear()
  ) {
    return 'earlier-this-month';
  }

  return `month-${postDay.getFullYear()}-${postDay.getMonth()}`;
}

function postedTimeGroupLabel(key: string, sampleDate: Date): string {
  const preset = GROUP_LABELS[key];
  if (preset) return preset;
  if (key.startsWith('month-')) {
    return sampleDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  return key;
}

const GROUP_SORT_ORDER = [
  'today',
  'yesterday',
  'this-week',
  'last-week',
  'earlier-this-month',
] as const;

function groupSortIndex(key: string): number {
  const idx = GROUP_SORT_ORDER.indexOf(key as (typeof GROUP_SORT_ORDER)[number]);
  if (idx >= 0) return idx;
  if (key.startsWith('month-')) {
    const [, y, m] = key.split('-');
    // After preset groups; larger month index = more recent month = sort earlier
    return GROUP_SORT_ORDER.length + (99999 - (Number(y) * 12 + Number(m)));
  }
  return 999;
}

function postedAtMs(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/** Group Instagram feedback posts into Today / Yesterday / This week / Last week / etc. */
export function groupPostedPostsByTime(
  posts: FeedbackPostRow[],
  today = startOfTodayLocal(),
): PostedTimeGroup[] {
  const sorted = [...posts].sort((a, b) => postedAtMs(b.postedAt) - postedAtMs(a.postedAt));
  const buckets = new Map<string, { posts: FeedbackPostRow[]; sampleDate: Date }>();

  for (const post of sorted) {
    const when = parsePostedAt(post.postedAt);
    if (!when) continue;
    const postDay = startOfLocalDay(when);
    const key = postedTimeGroupKey(postDay, today);
    const bucket = buckets.get(key);
    if (bucket) bucket.posts.push(post);
    else buckets.set(key, { posts: [post], sampleDate: postDay });
  }

  const groups: PostedTimeGroup[] = [];
  for (const [key, { posts: groupPosts, sampleDate }] of buckets) {
    groups.push({
      key,
      label: postedTimeGroupLabel(key, sampleDate),
      posts: groupPosts,
    });
  }

  groups.sort((a, b) => groupSortIndex(a.key) - groupSortIndex(b.key));
  return groups;
}

export function postedItemsForDay(posts: FeedbackPostRow[], day: Date): FeedbackPostRow[] {
  return posts.filter((post) => {
    const when = parsePostedAt(post.postedAt);
    return when != null && sameLocalDay(when, day);
  });
}

export function filterPostedInMonth(
  posts: FeedbackPostRow[],
  year: number,
  month: number,
): FeedbackPostRow[] {
  return posts.filter((post) => {
    const when = parsePostedAt(post.postedAt);
    return when != null && when.getFullYear() === year && when.getMonth() === month;
  });
}
