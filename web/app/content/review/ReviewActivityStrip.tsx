'use client';

import type { PublishingQueueItem } from '@/lib/publishing-types';
import {
  countActivePublishingJobs,
  type PublishNowFeedback,
} from '@/lib/publishing-publish-feedback';
import { isPipelineRunBusy } from '@/lib/pipeline-run-client';

export type ReviewActivityState = {
  publishingItems: PublishingQueueItem[];
  publishFeedbackByJobId: Record<string, PublishNowFeedback>;
  publishActingJobId?: string | null;
  pipelineRunStatus: string | null;
  generatingCandidates: boolean;
  regenerating: boolean;
  decidingCandidateId: string | null;
  savingNotes: boolean;
  refreshingReview: boolean;
  healingLedger: boolean;
};

function ActivityChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--warn)]">
      <span
        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--warn)]"
        aria-hidden
      />
      {children}
    </span>
  );
}

export function ReviewActivityStrip({ state }: { state: ReviewActivityState }) {
  const publishingCount = countActivePublishingJobs(
    state.publishingItems,
    state.publishFeedbackByJobId,
    state.publishActingJobId,
  );
  const pipelineBusy =
    state.generatingCandidates || isPipelineRunBusy(state.pipelineRunStatus);

  const chips: React.ReactNode[] = [];

  if (publishingCount > 0) {
    chips.push(
      <ActivityChip key="publish">
        Publishing {publishingCount} post{publishingCount === 1 ? '' : 's'} · continues in
        background
      </ActivityChip>,
    );
  }

  if (pipelineBusy) {
    chips.push(
      <ActivityChip key="pipeline">
        {state.generatingCandidates ? 'Dispatching candidate batch…' : 'Candidate generation running…'}
      </ActivityChip>,
    );
  }

  if (state.regenerating) {
    chips.push(<ActivityChip key="regen">Regenerating candidate…</ActivityChip>);
  }

  if (state.decidingCandidateId) {
    chips.push(<ActivityChip key="decide">Saving decision…</ActivityChip>);
  }

  if (state.savingNotes) {
    chips.push(<ActivityChip key="notes">Saving notes…</ActivityChip>);
  }

  if (state.refreshingReview) {
    chips.push(<ActivityChip key="refresh">Refreshing inbox…</ActivityChip>);
  }

  if (state.healingLedger) {
    chips.push(<ActivityChip key="heal">Healing asset ledger…</ActivityChip>);
  }

  if (chips.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 lg:px-6"
    >
      <div className="flex flex-wrap items-center gap-2">{chips}</div>
    </div>
  );
}
