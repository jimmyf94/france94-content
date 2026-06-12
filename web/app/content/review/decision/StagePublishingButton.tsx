'use client';

import { useState } from 'react';

import { CandidatePublishingPopover } from '../CandidatePublishingPopover';
import type { PostCandidate } from '../types';

function IconShare({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98" />
      <path d="M15.41 6.51l-6.82 3.98" />
    </svg>
  );
}

function canOpenPublishing(candidate: PostCandidate): boolean {
  if (candidate.invalidated_at) return false;
  return (
    candidate.status === 'approved' ||
    candidate.status === 'ready_to_publish' ||
    Boolean(candidate.publishing_job_id)
  );
}

export function StagePublishingButton({
  candidate,
  onStaged,
  onError,
  disabled,
}: {
  candidate: PostCandidate;
  onStaged?: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canOpenPublishing(candidate)) return null;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label="Publish"
        title="Schedule or publish"
        className="flex shrink-0 items-center justify-center rounded-md border border-blue-500 bg-blue-500 px-3 py-2.5 text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
      >
        <IconShare />
      </button>
      <CandidatePublishingPopover
        open={open}
        onClose={() => setOpen(false)}
        candidate={candidate}
        onUpdated={() => {
          onStaged?.();
        }}
        onError={onError}
      />
    </>
  );
}
