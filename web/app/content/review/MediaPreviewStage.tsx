'use client';

import { MainMediaPreview } from './MainMediaPreview';
import type { PostCandidate, ReviewDriveFile } from './types';
import { useCandidateMedia } from './useCandidateMedia';

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
}: {
  candidate: PostCandidate | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  if (!candidate) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] p-8 text-sm text-[var(--muted)]">
        Select a candidate from the queue.
      </section>
    );
  }
  return <Inner candidate={candidate} videoRef={videoRef} />;
}

function Inner({
  candidate,
  videoRef,
}: {
  candidate: PostCandidate;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const { files, loading, error } = useCandidateMedia(candidate.id);

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
          <MediaGrid files={files} candidateId={candidate.id} videoRef={videoRef} />
        )}
      </div>
    </section>
  );
}

function MediaGrid({
  files,
  candidateId,
  videoRef,
}: {
  files: ReviewDriveFile[];
  candidateId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const firstVideoIdx = files.findIndex((f) => f.mimeType.startsWith('video/'));
  return (
    <div
      className={`grid h-full w-full auto-rows-fr gap-3 ${gridColsClass(files.length)}`}
    >
      {files.map((f, i) => (
        <div key={f.id} className="flex min-h-0 min-w-0 items-center justify-center">
          <MainMediaPreview
            file={f}
            candidateId={candidateId}
            videoRef={i === firstVideoIdx ? videoRef : undefined}
            compact
          />
        </div>
      ))}
    </div>
  );
}
