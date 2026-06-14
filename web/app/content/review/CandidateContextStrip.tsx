'use client';

import { Fragment, type ReactNode } from 'react';

import { DecisionButtons } from './decision/DecisionButtons';
import { DeleteCandidateButton } from './decision/DeleteCandidateButton';
import { StagePublishingButton } from './decision/StagePublishingButton';
import { PostTypeBadge } from './PostTypeBadge';
import { ScoreStrip, hasCandidateScores } from './ScoreStrip';
import type { DecisionStatus, PostCandidate, ReviewDriveFile } from './types';
import { STATUS_TAB_LABEL } from './types';

function MetaSep() {
  return (
    <span className="select-none text-[var(--border)]" aria-hidden>
      |
    </span>
  );
}

function MetaRow({ items }: { items: ReactNode[] }) {
  const visible = items.filter(
    (item) => item !== null && item !== false && item !== undefined,
  );
  if (visible.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
      {visible.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <MetaSep />}
          {item}
        </Fragment>
      ))}
    </div>
  );
}

function CandidateMetaStrip({
  candidate,
  mediaFiles,
}: {
  candidate: PostCandidate;
  mediaFiles: ReviewDriveFile[];
}) {
  const assetLabel =
    mediaFiles.length > 0
      ? `${mediaFiles.length} asset${mediaFiles.length > 1 ? 's' : ''}`
      : null;

  const parts: ReactNode[] = [<PostTypeBadge key="type" postType={candidate.post_type} />];
  if (hasCandidateScores(candidate)) {
    parts.push(<ScoreStrip key="scores" candidate={candidate} compact />);
  }
  if (candidate.candidate_date) parts.push(candidate.candidate_date);
  if (assetLabel) parts.push(assetLabel);

  return <MetaRow items={parts} />;
}

function IconDrive({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M7.71 3.5 2.5 12.5h7.29L12 7.5l2.21 5h7.29L16.29 3.5H7.71Z"
        fill="#0066DA"
      />
      <path d="M12 7.5 9.79 12.5H2.5l5.21-9H12Z" fill="#00AC47" />
      <path d="M12 7.5h5.21L22.5 12.5H14.21L12 7.5Z" fill="#EA4335" />
      <path d="M14.21 12.5 12 17.5H4.71L2.5 12.5h7.29l2.21 5Z" fill="#00832D" />
      <path d="M14.21 12.5H22.5l-5.29-9H12l2.21 5Z" fill="#2684FC" />
      <path d="M12 17.5 9.79 12.5H2.5l2.21 5h7.29Z" fill="#FFBA00" />
    </svg>
  );
}

function IconContext({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function CandidateContextHover({ candidate }: { candidate: PostCandidate }) {
  if (!candidate.concept_summary && !candidate.rationale) return null;

  return (
    <div className="group/context relative shrink-0">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        aria-label="Context"
        title="Context"
      >
        <IconContext />
      </button>
      <div className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-[min(90vw,22rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 opacity-0 shadow-xl transition-opacity group-hover/context:pointer-events-auto group-hover/context:visible group-hover/context:opacity-100">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Context
        </p>
        <div className="space-y-2 text-sm leading-relaxed text-[var(--text)]">
          {candidate.concept_summary && <p>{candidate.concept_summary}</p>}
          {candidate.rationale && (
            <p className="text-[var(--muted)]">{candidate.rationale}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function CandidateContextStrip({
  candidate,
  mediaFiles = [],
  onDecide,
  onApproveAnyway,
  onDelete,
  deleting,
  deciding,
  onRefreshQueue,
  onStageError,
  decisionsDisabled,
  approveDisabled,
  allDecisionsDisabled,
}: {
  candidate: PostCandidate | null;
  mediaFiles?: ReviewDriveFile[];
  onDecide?: (s: DecisionStatus) => void;
  onApproveAnyway?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  deciding?: boolean;
  onRefreshQueue?: () => void;
  onStageError?: (message: string) => void;
  decisionsDisabled?: boolean;
  approveDisabled?: boolean;
  allDecisionsDisabled?: boolean;
}) {
  if (!candidate) return null;

  const statusLabel =
    STATUS_TAB_LABEL[candidate.status as keyof typeof STATUS_TAB_LABEL] ?? candidate.status;

  const showApproveAnyway =
    onApproveAnyway &&
    ['blocked', 'high'].includes((candidate.collision_risk ?? '').trim()) &&
    !candidate.invalidated_at &&
    candidate.status !== 'ready_to_publish';

  const assetLabel =
    mediaFiles.length > 0
      ? `${mediaFiles.length} asset${mediaFiles.length > 1 ? 's' : ''}`
      : null;

  const titleRowItems: ReactNode[] = [
    <span
      key="title"
      className="max-w-[16rem] truncate text-sm font-semibold text-[var(--text)] sm:max-w-xs lg:max-w-md"
    >
      {candidate.title || '(untitled)'}
    </span>,
  ];
  if (candidate.hook) {
    titleRowItems.push(
      <span
        key="hook"
        className="max-w-[12rem] truncate text-sm text-[var(--muted)] sm:max-w-xs"
      >
        {candidate.hook}
      </span>,
    );
  }
  titleRowItems.push(
    <span key="status" className="cockpit-pill capitalize">
      {statusLabel}
    </span>,
  );
  if (candidate.review_drive_folder_url) {
    titleRowItems.push(
      <a
        key="drive"
        href={candidate.review_drive_folder_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center rounded-md p-0.5 transition-opacity hover:opacity-80"
        aria-label="Open in Drive"
        title="Open in Drive"
      >
        <IconDrive />
      </a>,
    );
  }
  if (candidate.concept_summary || candidate.rationale) {
    titleRowItems.push(<CandidateContextHover key="context" candidate={candidate} />);
  }

  return (
    <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 lg:px-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <CandidateMetaStrip candidate={candidate} mediaFiles={mediaFiles} />
          <MetaRow items={titleRowItems} />
        </div>

        {(onDecide || onDelete || onRefreshQueue) && (
          <div className="flex w-full shrink-0 flex-col gap-2 lg:w-auto">
            <div className="flex items-center gap-2">
              {onDecide && (
                <DecisionButtons
                  onDecide={onDecide}
                  variant="iconOnly"
                  size="md"
                  showShortcuts={false}
                  disabled={decisionsDisabled || deciding}
                  approveDisabled={approveDisabled}
                  allDecisionsDisabled={allDecisionsDisabled}
                />
              )}
              <StagePublishingButton
                candidate={candidate}
                onStaged={onRefreshQueue}
                onError={onStageError}
              />
              {onDelete && (
                <DeleteCandidateButton
                  onDelete={onDelete}
                  variant="iconOnly"
                  disabled={
                    Boolean(deleting) ||
                    candidate.status === 'ready_to_publish' ||
                    Boolean(candidate.invalidated_at)
                  }
                />
              )}
            </div>
            {showApproveAnyway && (
              <button
                type="button"
                onClick={() => onApproveAnyway()}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
              >
                Approve anyway
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
