'use client';

import { MainMediaPreview } from './MainMediaPreview';
import { ReviewMediaTrashButton } from './ReviewMediaTrashButton';
import type { CandidateMediaState } from './useCandidateMedia';
import type { PostCandidate, ReviewDriveFile } from './types';

function gridColsClass(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-2';
  if (n === 3) return 'grid-cols-3';
  if (n === 4) return 'grid-cols-2';
  if (n <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

export function MediaPreviewStage({
  candidate,
  videoRef,
  media,
  onRegisterActivateStream,
  onRemoveReviewAsset,
}: {
  candidate: PostCandidate | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  media: CandidateMediaState;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
}) {
  if (!candidate) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] p-8 text-sm text-[var(--muted)]">
        Select a candidate from the queue.
      </section>
    );
  }

  const { files, loading, error } = media;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 lg:p-6">
        {loading && <p className="text-sm text-[var(--muted)]">Loading media…</p>}
        {!loading && error && (
          <p className="text-sm text-[var(--bad)]">Could not load media: {error}</p>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="flex flex-col items-center gap-3 text-sm text-[var(--muted)]">
            <p>No media in review folder.</p>
            {candidate.review_drive_folder_url && (
              <a
                href={candidate.review_drive_folder_url}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--accent)]"
              >
                Open review folder
              </a>
            )}
          </div>
        )}
        {!loading && !error && files.length > 0 && (
          <MediaGrid
            candidate={candidate}
            files={files}
            candidateId={candidate.id}
            videoRef={videoRef}
            onRegisterActivateStream={onRegisterActivateStream}
            onRemoveReviewAsset={onRemoveReviewAsset}
          />
        )}
      </div>
    </section>
  );
}

function MediaGrid({
  candidate,
  files,
  candidateId,
  videoRef,
  onRegisterActivateStream,
  onRemoveReviewAsset,
}: {
  candidate: PostCandidate;
  files: ReviewDriveFile[];
  candidateId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
}) {
  const firstVideoIdx = files.findIndex((f) => f.mimeType.startsWith('video/'));
  const canDetachSource =
    (candidate.source_asset_ids?.length ?? 0) > 0 && Boolean(candidate.review_drive_folder_id);
  return (
    <div
      className={`grid h-full w-full auto-rows-fr gap-3 ${gridColsClass(files.length)}`}
    >
      {files.map((f, i) => {
        const showTrash = !!onRemoveReviewAsset && canDetachSource;
        return (
          <div
            key={f.id}
            className="relative flex min-h-0 min-w-0 items-center justify-center"
          >
            {showTrash && (
              <ReviewMediaTrashButton file={f} onRemove={onRemoveReviewAsset} />
            )}
            <MainMediaPreview
              file={f}
              candidateId={candidateId}
              videoRef={i === firstVideoIdx ? videoRef : undefined}
              onRegisterActivateStream={
                i === firstVideoIdx ? onRegisterActivateStream : undefined
              }
              compact
            />
          </div>
        );
      })}
    </div>
  );
}
