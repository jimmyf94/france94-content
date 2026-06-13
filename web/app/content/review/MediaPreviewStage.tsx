'use client';

import { useState } from 'react';

import { orderedCarouselAssetIds, moveCarouselAssetId } from '@/lib/reorder-candidate-carousel-slides';

import { CarouselAssetPickerModal } from './CarouselAssetPickerModal';
import { MainMediaPreview } from './MainMediaPreview';
import { ReviewMediaTrashButton } from './ReviewMediaTrashButton';
import type { CandidateMediaState } from './useCandidateMedia';
import type { PostCandidate, ReviewDriveFile } from './types';

const CAROUSEL_MAX_SLIDES = 10;

function gridColsClass(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-2';
  if (n === 3) return 'grid-cols-3';
  if (n === 4) return 'grid-cols-2';
  if (n <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

function carouselSlideCount(candidate: PostCandidate): number {
  if (Array.isArray(candidate.carousel_slides) && candidate.carousel_slides.length > 0) {
    return candidate.carousel_slides.length;
  }
  return candidate.source_asset_ids?.length ?? 0;
}

export function MediaPreviewStage({
  candidate,
  videoRef,
  media,
  onRegisterActivateStream,
  onRemoveReviewAsset,
  onCarouselAssetsAdded,
  onReorderCarouselSlides,
}: {
  candidate: PostCandidate | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  media: CandidateMediaState;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  onCarouselAssetsAdded?: (candidate: PostCandidate) => void;
  onReorderCarouselSlides?: (orderedAssetIds: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!candidate) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] p-8 text-sm text-[var(--muted)]">
        Select a candidate from the queue.
      </section>
    );
  }

  const { files, loading, error } = media;
  const slideCount = carouselSlideCount(candidate);
  const canAddCarouselSlides =
    candidate.post_type === 'carousel' &&
    Boolean(candidate.review_drive_folder_id) &&
    slideCount < CAROUSEL_MAX_SLIDES &&
    !!onCarouselAssetsAdded;
  const canReorderCarouselSlides =
    candidate.post_type === 'carousel' &&
    Boolean(candidate.review_drive_folder_id) &&
    slideCount > 1 &&
    !!onReorderCarouselSlides;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      {candidate.post_type === 'carousel' && files.length > 0 && (
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          <p className="font-medium text-[var(--text)]">Carousel editor</p>
          <p className="mt-0.5">
            Order matters for publishing. Caption is one per carousel — edit it in the Caption tab.
          </p>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 lg:p-6">
        {loading && <p className="text-sm text-[var(--muted)]">Loading media…</p>}
        {!loading && error && (
          <p className="text-sm text-[var(--bad)]">Could not load media: {error}</p>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="flex flex-col items-center gap-3 text-sm text-[var(--muted)]">
            <p>No media in review folder.</p>
            {canAddCarouselSlides && (
              <AddSlideGhostTile
                slideCount={slideCount}
                maxSlides={CAROUSEL_MAX_SLIDES}
                onClick={() => setPickerOpen(true)}
                className="h-40 w-40"
              />
            )}
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
            canAddCarouselSlides={canAddCarouselSlides}
            canReorderCarouselSlides={canReorderCarouselSlides}
            slideCount={slideCount}
            onOpenPicker={() => setPickerOpen(true)}
            onReorderCarouselSlides={onReorderCarouselSlides}
          />
        )}
      </div>
      {canAddCarouselSlides && onCarouselAssetsAdded && (
        <CarouselAssetPickerModal
          open={pickerOpen}
          candidateId={candidate.id}
          attachedAssetIds={candidate.source_asset_ids ?? []}
          slideCount={slideCount}
          maxSlides={CAROUSEL_MAX_SLIDES}
          onClose={() => setPickerOpen(false)}
          onAdded={(updated) => {
            setPickerOpen(false);
            onCarouselAssetsAdded(updated);
          }}
        />
      )}
    </section>
  );
}

function AddSlideGhostTile({
  slideCount,
  maxSlides,
  onClick,
  disabled,
  className = '',
}: {
  slideCount: number;
  maxSlides: number;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--surface)]/40 p-4 text-center transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <span className="text-2xl font-light text-[var(--accent)]">+</span>
      <span className="text-xs font-medium text-[var(--text)]">Add from library</span>
      <span className="text-[10px] text-[var(--muted)]">
        {slideCount}/{maxSlides}
      </span>
    </button>
  );
}

function MediaGrid({
  candidate,
  files,
  candidateId,
  videoRef,
  onRegisterActivateStream,
  onRemoveReviewAsset,
  canAddCarouselSlides,
  canReorderCarouselSlides,
  slideCount,
  onOpenPicker,
  onReorderCarouselSlides,
}: {
  candidate: PostCandidate;
  files: ReviewDriveFile[];
  candidateId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  canAddCarouselSlides: boolean;
  canReorderCarouselSlides: boolean;
  slideCount: number;
  onOpenPicker: () => void;
  onReorderCarouselSlides?: (orderedAssetIds: string[]) => void;
}) {
  const firstVideoIdx = files.findIndex((f) => f.mimeType.startsWith('video/'));
  const canDetachSource =
    (candidate.source_asset_ids?.length ?? 0) > 0 && Boolean(candidate.review_drive_folder_id);
  const gridCells = files.length + (canAddCarouselSlides ? 1 : 0);

  const orderedAssetIds = files
    .map((f) => f.sourceAssetId?.trim())
    .filter((id): id is string => Boolean(id));
  const fallbackOrder = orderedCarouselAssetIds(
    candidate.source_asset_ids,
    candidate.carousel_slides,
  );
  const displayOrder =
    orderedAssetIds.length === files.length
      ? orderedAssetIds
      : fallbackOrder.length === files.length
        ? fallbackOrder
        : [];

  const moveSlide = (index: number, direction: 'left' | 'right') => {
    if (!onReorderCarouselSlides || displayOrder.length === 0) return;
    const next = moveCarouselAssetId(displayOrder, index, direction);
    if (typeof next === 'object' && 'error' in next) return;
    if (JSON.stringify(next) === JSON.stringify(displayOrder)) return;
    onReorderCarouselSlides(next);
  };

  return (
    <div
      className={`grid h-full w-full auto-rows-fr gap-3 ${gridColsClass(gridCells)}`}
    >
      {files.map((f, i) => {
        const showTrash = !!onRemoveReviewAsset && canDetachSource;
        const showReorder = canReorderCarouselSlides && displayOrder.length === files.length;
        return (
          <div
            key={f.id}
            className="relative flex min-h-0 min-w-0 flex-col items-center justify-center"
          >
            {showReorder && (
              <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
                <span className="rounded bg-[var(--surface)]/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--accent)]">
                  {i + 1}
                </span>
              </div>
            )}
            {showReorder && (
              <div className="absolute bottom-2 left-2 right-2 z-10 flex justify-center gap-1">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => moveSlide(i, 'left')}
                  className="rounded border border-[var(--border)] bg-[var(--surface)]/90 px-2 py-0.5 text-[10px] text-[var(--muted)] disabled:opacity-40"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={i === files.length - 1}
                  onClick={() => moveSlide(i, 'right')}
                  className="rounded border border-[var(--border)] bg-[var(--surface)]/90 px-2 py-0.5 text-[10px] text-[var(--muted)] disabled:opacity-40"
                >
                  →
                </button>
              </div>
            )}
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
      {canAddCarouselSlides && (
        <AddSlideGhostTile
          slideCount={slideCount}
          maxSlides={CAROUSEL_MAX_SLIDES}
          onClick={onOpenPicker}
          className="min-h-[120px] w-full"
        />
      )}
    </div>
  );
}
