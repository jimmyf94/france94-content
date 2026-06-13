'use client';

import { useMemo, useState } from 'react';

import {
  CALENDAR_WEEKDAY_LABELS,
  calendarMonthCells,
  startOfTodayLocal,
} from '@/lib/publishing-schedule-datetime';

import { PublishingCalendarCard } from './PublishingCalendarCard';
import { PublishingQueueRow } from './PublishingQueueRow';
import { postedItemsForDay } from './publishingPostedFeed';
import {
  formatScheduledTime,
  groupScheduledByDay,
  scheduledItemsForDay,
  splitPublishingQueueItems,
} from './publishingQueueSplit';
import { RecentlyPostedColumn } from './RecentlyPostedColumn';
import { useFeedbackPosts } from './useFeedbackPosts';
import { usePublishingScheduleQueue } from './usePublishingScheduleQueue';

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function PublishingCalendarView() {
  const today = useMemo(() => startOfTodayLocal(), []);
  const [viewYear, setViewYear] = useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => today.getMonth());

  const {
    items,
    loading,
    error,
    actingJobId,
    load,
    schedulePublish,
    unschedulePublish,
    unstagePublish,
    publishNow,
  } = usePublishingScheduleQueue();

  const {
    posts: postedPosts,
    loading: postedLoading,
    error: postedError,
    load: loadPosted,
  } = useFeedbackPosts(50);

  const { scheduled, unscheduled } = useMemo(
    () => splitPublishingQueueItems(items),
    [items],
  );

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

  const agendaGroups = useMemo(() => {
    const inMonth = scheduled.filter((item) => {
      if (!item.scheduled_publish_at) return false;
      const when = new Date(item.scheduled_publish_at);
      return when.getFullYear() === viewYear && when.getMonth() === viewMonth;
    });
    return groupScheduledByDay(inMonth, today);
  }, [scheduled, today, viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const navBtnClass =
    'rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40';

  const monthNav = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => shiftMonth(-1)}
        className={navBtnClass}
        aria-label="Previous month"
      >
        ←
      </button>
      <button
        type="button"
        onClick={() => {
          setViewYear(today.getFullYear());
          setViewMonth(today.getMonth());
        }}
        className={navBtnClass}
      >
        Today
      </button>
      <button
        type="button"
        onClick={() => shiftMonth(1)}
        className={navBtnClass}
        aria-label="Next month"
      >
        →
      </button>
    </div>
  );

  const readyQueue = (
    <>
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold">Ready to schedule</h2>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          Posts without a go-live time appear here
        </p>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
        {loading && unscheduled.length === 0 && (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        )}
        {!loading && unscheduled.length === 0 && (
          <p className="text-sm text-[var(--muted)]">All queued posts are scheduled.</p>
        )}
        {unscheduled.length > 0 && (
          <ul className="flex list-none flex-col gap-2" role="list">
            {unscheduled.map((item) => (
              <PublishingQueueRow
                key={item.id}
                item={item}
                acting={actingJobId === item.id}
                onSchedule={schedulePublish}
                onUnschedule={unschedulePublish}
                onPublishNow={publishNow}
                onUnstage={unstagePublish}
                onContentUpdated={() => void load()}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)] text-[var(--text)]">
      {error && (
        <p className="shrink-0 border-b border-[var(--border)] px-5 py-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      )}
      {postedError && !error && (
        <p className="shrink-0 border-b border-[var(--border)] px-5 py-2 text-xs text-[var(--bad)]">
          {postedError}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(280px,360px)]">
        {/* Desktop recently posted column */}
        <aside className="hidden min-h-0 flex-col border-b border-[var(--border)] bg-[var(--surface)] lg:flex lg:border-r lg:border-b-0">
          <RecentlyPostedColumn
            posts={postedPosts}
            loading={postedLoading}
            error={postedError}
            onRefresh={() => void loadPosted()}
          />
        </aside>

        {/* Mobile recently posted */}
        <section className="flex max-h-64 min-h-0 flex-col border-b border-[var(--border)] bg-[var(--surface)] lg:hidden">
          <RecentlyPostedColumn
            posts={postedPosts}
            loading={postedLoading}
            error={postedError}
            onRefresh={() => void loadPosted()}
            compact
          />
        </section>

        {/* Desktop month calendar */}
        <section className="hidden min-h-0 flex-col border-b border-[var(--border)] lg:flex lg:border-r lg:border-b-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-sm font-semibold">{monthLabel}</h2>
            {monthNav}
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
            <div className="grid grid-cols-7 gap-1">
              {CALENDAR_WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
                >
                  {label}
                </div>
              ))}

              {monthCells.map((day, index) => {
                if (!day) {
                  return (
                    <div
                      key={`empty-${index}`}
                      className="min-h-[7.5rem] rounded-lg border border-transparent bg-transparent"
                      aria-hidden
                    />
                  );
                }

                const dayItems = scheduledItemsForDay(scheduled, day);
                const dayPosted = postedItemsForDay(postedPosts, day);
                const isToday = sameDay(day, today);
                const inMonth = day.getMonth() === viewMonth;

                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[7.5rem] rounded-lg border p-2 ${
                      inMonth
                        ? 'border-[var(--border)] bg-[var(--surface)]'
                        : 'border-transparent bg-[var(--surface)]/40 opacity-60'
                    } ${isToday ? 'ring-1 ring-[var(--accent)]/60' : ''}`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          isToday ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {dayPosted.length > 0 && (
                          <span
                            className="text-[10px] tabular-nums text-[var(--good)]"
                            title={`${dayPosted.length} posted`}
                          >
                            {dayPosted.length} posted
                          </span>
                        )}
                        {dayItems.length > 0 && (
                          <span
                            className="text-[10px] tabular-nums text-[var(--muted)]"
                            title={`${dayItems.length} scheduled`}
                          >
                            {dayItems.length} sched
                          </span>
                        )}
                      </div>
                    </div>
                    {dayPosted.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-0.5">
                        {dayPosted.slice(0, 3).map((post) =>
                          post.thumbnailUrl ? (
                            <a
                              key={post.id}
                              href={post.permalink ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-5 w-5 overflow-hidden rounded border border-[var(--border)]"
                              title={`Posted: ${post.postTypeLabel}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={post.thumbnailUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            </a>
                          ) : null,
                        )}
                        {dayPosted.length > 3 && (
                          <span className="flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-2)] text-[8px] text-[var(--muted)]">
                            +{dayPosted.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {dayItems.map((item) => (
                        <PublishingCalendarCard
                          key={item.id}
                          item={item}
                          acting={actingJobId === item.id}
                          onSchedule={schedulePublish}
                          onUnschedule={unschedulePublish}
                          onUnstage={unstagePublish}
                          onContentUpdated={() => void load()}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {loading && scheduled.length === 0 && (
              <p className="mt-4 text-sm text-[var(--muted)]">Loading calendar…</p>
            )}
            {!loading && scheduled.length === 0 && (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No scheduled posts yet. Schedule from the queue on the right.
              </p>
            )}
          </div>
        </section>

        {/* Mobile scheduled agenda */}
        <section className="flex min-h-0 flex-col border-b border-[var(--border)] lg:hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Scheduled</h2>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">{monthLabel}</p>
            </div>
            {monthNav}
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
            {loading && scheduled.length === 0 && (
              <p className="text-sm text-[var(--muted)]">Loading scheduled posts…</p>
            )}
            {!loading && scheduled.length === 0 && (
              <p className="text-sm text-[var(--muted)]">
                No scheduled posts yet. Schedule from the queue below.
              </p>
            )}
            {!loading && scheduled.length > 0 && agendaGroups.length === 0 && (
              <p className="text-sm text-[var(--muted)]">No scheduled posts in this month.</p>
            )}
            {agendaGroups.length > 0 && (
              <div className="space-y-4">
                {agendaGroups.map((group) => (
                  <div key={group.dayKey}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {group.label}
                    </h3>
                    <ul className="flex list-none flex-col gap-2" role="list">
                      {group.items.map((item) => (
                        <PublishingQueueRow
                          key={item.id}
                          item={item}
                          acting={actingJobId === item.id}
                          onSchedule={schedulePublish}
                          onUnschedule={unschedulePublish}
                          onPublishNow={publishNow}
                          onUnstage={unstagePublish}
                          onContentUpdated={() => void load()}
                          showScheduledTime={
                            item.scheduled_publish_at
                              ? formatScheduledTime(item.scheduled_publish_at)
                              : undefined
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-[var(--surface)]">{readyQueue}</aside>
      </div>
    </div>
  );
}
