'use client';

import { useMemo } from 'react';

import type { PublishingQueueItem } from '@/lib/publishing-types';
import type { PublishNowFeedback } from '@/lib/publishing-publish-feedback';

import { PublishingQueueRow } from '../publishing/PublishingQueueRow';
import type { ReviewFilters } from './FilterDrawer';
import { FilterToggleButton } from './FilterToggleButton';
import { QueueRow } from './QueueRow';
import type { CandidateListItem, StatusTab } from './types';
import { STATUS_TAB_LABEL } from './types';

const TAB_ORDER: StatusTab[] = [
  'needs_review',
  'needs_rewrite',
  'approved',
  'publishing',
  'rejected',
];

type PublishingSidebarProps = {
  publishingItems?: PublishingQueueItem[];
  publishingLoading?: boolean;
  publishingActingJobId?: string | null;
  publishingFeedbackByJobId?: Record<string, PublishNowFeedback>;
  publishingPublishActingJobId?: string | null;
  onSchedulePublish?: (jobId: string, iso: string) => void | Promise<void>;
  onUnschedulePublish?: (jobId: string) => void | Promise<void>;
  onPublishNow?: (jobId: string) => void | Promise<void>;
  onUnstagePublish?: (jobId: string) => void | Promise<void>;
  onRefreshPublishing?: () => void;
};

export function CandidateQueueSidebar({
  candidates,
  counts,
  activeTab,
  onChangeTab,
  selectedId,
  onSelect,
  loading,
  firstThumbnailById = {},
  filters,
  onChangeFilters,
  filtersOpen,
  onToggleFilters,
  onCloseFilters,
  publishingItems = [],
  publishingLoading = false,
  publishingActingJobId = null,
  publishingFeedbackByJobId = {},
  publishingPublishActingJobId = null,
  onSchedulePublish,
  onUnschedulePublish,
  onPublishNow,
  onUnstagePublish,
  onRefreshPublishing,
}: {
  candidates: CandidateListItem[];
  counts: Record<StatusTab, number>;
  activeTab: StatusTab;
  onChangeTab: (t: StatusTab) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  firstThumbnailById?: Readonly<Record<string, string | null>>;
  filters?: ReviewFilters;
  onChangeFilters?: (f: ReviewFilters) => void;
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
  onCloseFilters?: () => void;
} & PublishingSidebarProps) {
  const isPublishingTab = activeTab === 'publishing';

  const visible = useMemo(
    () =>
      candidates.filter((c) =>
        activeTab === 'approved'
          ? c.status === 'approved' || c.status === 'produced'
          : c.status === activeTab,
      ),
    [candidates, activeTab],
  );

  const listCount = isPublishingTab ? publishingItems.length : visible.length;
  const listLoading = isPublishingTab ? publishingLoading : loading;

  const scheduledCount = publishingItems.filter((i) => i.status === 'scheduled').length;
  const readyCount = publishingItems.filter((i) => i.status === 'ready_to_publish').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3 pt-3 pb-2">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Review inbox
          </h2>
          {isPublishingTab && publishingItems.length > 0 && (
            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
              {scheduledCount} scheduled · {readyCount} ready
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isPublishingTab && onRefreshPublishing && (
            <button
              type="button"
              onClick={onRefreshPublishing}
              disabled={publishingLoading}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              Refresh
            </button>
          )}
          {!isPublishingTab &&
            filters &&
            onChangeFilters &&
            onToggleFilters &&
            onCloseFilters && (
              <FilterToggleButton
                filters={filters}
                onChangeFilters={onChangeFilters}
                open={filtersOpen ?? false}
                onToggle={onToggleFilters}
                onClose={onCloseFilters}
                popoverAlign="left"
              />
            )}
          <span className="text-[11px] tabular-nums text-[var(--text)]">{listCount}</span>
        </div>
      </div>
      <div className="shrink-0 border-b border-[var(--border)] p-2">
        <div className="flex flex-col gap-0.5">
          {TAB_ORDER.map((t) => {
            const isActive = activeTab === t;
            const count = counts[t];
            if (count === 0 && !isActive) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChangeTab(t)}
                className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-muted)] font-medium text-[var(--text)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                }`}
              >
                <span className="truncate">{STATUS_TAB_LABEL[t]}</span>
                <span className="shrink-0 tabular-nums text-[11px] opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-hidden">
        {listLoading && listCount === 0 && (
          <p className="p-3 text-sm text-[var(--muted)]">Loading…</p>
        )}
        {!listLoading && listCount === 0 && (
          <p className="p-3 text-sm text-[var(--muted)]">
            {isPublishingTab ? 'No posts queued to go live.' : 'Inbox empty.'}
          </p>
        )}
        {isPublishingTab && publishingItems.length > 0 && (
          <ul
            className="scrollbar-thin flex min-h-0 flex-1 list-none flex-col gap-2 overflow-auto p-2"
            role="list"
          >
            {publishingItems.map((item) => (
              <li key={item.id} className="[content-visibility:auto]">
                <PublishingQueueRow
                  item={item}
                  acting={publishingActingJobId === item.id}
                  publishActing={publishingPublishActingJobId === item.id}
                  publishFeedback={publishingFeedbackByJobId[item.id] ?? null}
                  onSchedule={(jobId, iso) => void onSchedulePublish?.(jobId, iso)}
                  onUnschedule={(jobId) => void onUnschedulePublish?.(jobId)}
                  onPublishNow={(jobId) => void onPublishNow?.(jobId)}
                  onUnstage={(jobId) => void onUnstagePublish?.(jobId)}
                  compact
                  onSelectCandidate={onSelect}
                  selected={selectedId === item.post_candidate_id}
                />
              </li>
            ))}
          </ul>
        )}
        {!isPublishingTab && visible.length > 0 && (
          <ul
            className="scrollbar-thin flex min-h-0 flex-1 list-none flex-col gap-1 overflow-auto p-2"
            role="list"
          >
            {visible.map((c) => (
              <li key={c.id} className="[content-visibility:auto]">
                <QueueRow
                  candidate={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                  firstThumbnailUrl={firstThumbnailById[c.id] ?? null}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
