'use client';

import Link from 'next/link';

import { PostTypeBadge } from './PostTypeBadge';
import { ScoreStrip } from './ScoreStrip';
import type { PostCandidate, ReviewDriveFile } from './types';

function assetSummary(files: ReviewDriveFile[]): string {
  if (files.length === 0) return '';
  let videos = 0;
  let images = 0;
  let other = 0;
  for (const f of files) {
    if (f.mimeType.startsWith('video/')) videos++;
    else if (f.mimeType.startsWith('image/')) images++;
    else other++;
  }
  const parts: string[] = [];
  if (videos > 0) parts.push(`${videos} video${videos > 1 ? 's' : ''}`);
  if (images > 0) parts.push(`${images} image${images > 1 ? 's' : ''}`);
  if (other > 0) parts.push(`${other} file${other > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
      {children}
    </span>
  );
}

export function CandidateOverviewHeader({
  candidate,
  mediaFiles = [],
}: {
  candidate: PostCandidate | null;
  mediaFiles?: ReviewDriveFile[];
}) {
  if (!candidate) return null;
  const assets = assetSummary(mediaFiles);

  return (
    <>
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <PostTypeBadge postType={candidate.post_type} />
              {assets && <MetaChip>{assets}</MetaChip>}
              {candidate.candidate_date && <MetaChip>{candidate.candidate_date}</MetaChip>}
              {candidate.asset_conflict_summary && (
                <MetaChip>Asset warning</MetaChip>
              )}
              {candidate.freshness_warning && <MetaChip>Stale story</MetaChip>}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold leading-snug text-[var(--text)]">
                {candidate.title || '(untitled)'}
              </h2>
              {candidate.review_drive_folder_url && (
                <a
                  href={candidate.review_drive_folder_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--accent)] underline hover:opacity-80"
                >
                  Review folder
                </a>
              )}
              {candidate.publishing_job_id && (
                <Link
                  href={`/content/publishing/${candidate.publishing_job_id}`}
                  className="text-xs text-[var(--accent)] underline hover:opacity-80"
                >
                  Publishing prep
                </Link>
              )}
            </div>
            {candidate.hook && (
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{candidate.hook}</p>
            )}
          </div>
          <ScoreStrip candidate={candidate} />
        </div>
      </header>
      {(candidate.concept_summary || candidate.rationale) && (
        <section className="shrink-0 space-y-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-6 py-2.5">
          {candidate.concept_summary && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Concept
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
                {candidate.concept_summary}
              </p>
            </div>
          )}
          {candidate.rationale && (
            <details className="group">
              <summary className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--text)]">
                <span className="inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
                Rationale
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                {candidate.rationale}
              </p>
            </details>
          )}
        </section>
      )}
    </>
  );
}
