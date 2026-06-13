'use client';

import { ProductionJobCard } from './ProductionJobCard';
import { CandidateContextStrip } from './CandidateContextStrip';
import { MediaPreviewStage } from './MediaPreviewStage';
import type { DecisionStatus, PostCandidate, ReviewDriveFile } from './types';
import type { CandidateMediaState } from './useCandidateMedia';

export function ActiveCandidateWorkspace({
  candidate,
  media,
  videoRef,
  onRegisterActivateStream,
  onRemoveReviewAsset,
  onCarouselAssetsAdded,
  onReorderCarouselSlides,
  onCandidateUpdated,
  onVariantCreated,
  onDecide,
  onApproveAnyway,
  onDelete,
  deleting,
  onRefreshQueue,
  onStageError,
  decisionsDisabled,
  approveDisabled,
  allDecisionsDisabled,
}: {
  candidate: PostCandidate | null;
  media: CandidateMediaState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  onCarouselAssetsAdded?: (c: PostCandidate) => void;
  onReorderCarouselSlides?: (orderedAssetIds: string[]) => void;
  onCandidateUpdated?: (c: PostCandidate) => void;
  onVariantCreated?: (c: PostCandidate) => void;
  onDecide?: (s: DecisionStatus) => void;
  onApproveAnyway?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  onRefreshQueue?: () => void;
  onStageError?: (message: string) => void;
  decisionsDisabled?: boolean;
  approveDisabled?: boolean;
  allDecisionsDisabled?: boolean;
}) {
  if (!candidate) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)] p-8 text-sm text-[var(--muted)]">
        Select a candidate from the inbox.
      </section>
    );
  }

  const isReel = candidate.post_type === 'reel';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      <CandidateContextStrip
        candidate={candidate}
        mediaFiles={media.files}
        onDecide={onDecide}
        onApproveAnyway={onApproveAnyway}
        onDelete={onDelete}
        deleting={deleting}
        onRefreshQueue={onRefreshQueue}
        onStageError={onStageError}
        decisionsDisabled={decisionsDisabled}
        approveDisabled={approveDisabled}
        allDecisionsDisabled={allDecisionsDisabled}
      />
      {isReel ? (
        <ProductionJobCard
          candidate={candidate}
          layout="workspace"
          onVariantCreated={onVariantCreated}
          onCandidateUpdated={onCandidateUpdated}
          media={media}
          videoRef={videoRef}
          onRegisterActivateStream={onRegisterActivateStream}
          onRemoveReviewAsset={onRemoveReviewAsset}
        />
      ) : (
        <MediaPreviewStage
          candidate={candidate}
          videoRef={videoRef}
          media={media}
          onRegisterActivateStream={onRegisterActivateStream}
          onRemoveReviewAsset={onRemoveReviewAsset}
          onCarouselAssetsAdded={onCarouselAssetsAdded}
          onReorderCarouselSlides={onReorderCarouselSlides}
        />
      )}
    </div>
  );
}
