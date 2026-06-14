'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PublishingQueueItem } from '@/lib/publishing-types';

import { CandidateIterationPanel } from '../CandidateIterationPanel';
import { PublishedFeedbackStrip } from '../PublishedFeedbackStrip';
import { CandidateQueueSidebar } from '../CandidateQueueSidebar';
import { DeleteCandidateButton } from '../decision/DeleteCandidateButton';
import { StagePublishingButton } from '../decision/StagePublishingButton';
import { DecisionButtons } from '../decision/DecisionButtons';
import { ProductionJobCard } from '../ProductionJobCard';
import { PublishingPrepCard } from '../PublishingPrepCard';
import { RewriteChips } from '../decision/RewriteChips';
import { FilterForm, type ReviewFilters } from '../FilterDrawer';
import { hasActiveReviewFilters, IconFilter } from '../FilterToggleButton';
import { MainMediaPreview } from '../MainMediaPreview';
import { ReviewMediaTrashButton } from '../ReviewMediaTrashButton';
import { PostTypeBadge } from '../PostTypeBadge';
import { ScoreStrip } from '../ScoreStrip';
import { CaptionTab } from '../tabs/CaptionTab';
import { DebugTab } from '../tabs/DebugTab';
import { StructureTab } from '../tabs/StructureTab';
import { TranscriptTab } from '../tabs/TranscriptTab';
import type {
  CandidateListItem,
  DecisionStatus,
  DetailTab,
  PostCandidate,
  ReviewDriveFile,
  StatusTab,
} from '../types';
import { STATUS_TAB_LABEL, isLockedReviewCandidate } from '../types';
import type { CandidateMediaState } from '../useCandidateMedia';

import { BottomSheet } from './BottomSheet';

type MobileSheet = null | 'queue' | 'details' | 'filters';

type MobileDetailSheetTab = Exclude<DetailTab, 'caption'>;

const MOBILE_DETAIL_SHEET_TABS: { id: MobileDetailSheetTab; label: string }[] = [
  { id: 'structure', label: 'Structure' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'debug', label: 'Debug' },
];

function appendNote(notes: string, chip: string): string {
  return notes.trim() ? `${notes.trim()} · ${chip}` : chip;
}

function formatRelativeFromNow(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} d ago`;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    needs_review: 'border-[var(--accent)] text-[var(--accent)]',
    needs_rewrite: 'border-[var(--warn)] text-[var(--warn)]',
    approved: 'border-[var(--good)] text-[var(--good)]',
    publishing: 'border-[var(--good)] text-[var(--good)]',
    published: 'border-[var(--good)] text-[var(--good)]',
    rejected: 'border-[var(--bad)] text-[var(--bad)]',
  };
  const tone = map[status] ?? 'border-[var(--border)] text-[var(--muted)]';
  const label = STATUS_TAB_LABEL[status as keyof typeof STATUS_TAB_LABEL] ?? status;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
      {children}
    </span>
  );
}

export function MobileReviewStack({
  queueCandidates,
  counts,
  activeStatusTab,
  onChangeStatusTab,
  selected,
  onSelect,
  notes,
  savedNotes,
  onChangeNotes,
  onSaveNotes,
  onDecide,
  onApproveAnyway,
  activeDetailTab,
  onChangeDetailTab,
  mobileSheet,
  onChangeSheet,
  filters,
  onChangeFilters,
  videoRef,
  loading,
  onRefresh,
  onRefreshQueue,
  onSwipeNext,
  onSwipePrev,
  media,
  onRegisterActivateStream,
  firstThumbnailById = {},
  onCandidateUpdated,
  onVariantCreated,
  onSpawnCreated,
  onGoToSpawnInReview,
  onRemoveReviewAsset,
  onRegenerate,
  regenerating,
  savingNotes,
  onDelete,
  deleting,
  deciding,
  onGenerateCandidates,
  generatingCandidates,
  generateDisabled,
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
  queueCandidates: CandidateListItem[];
  counts: Record<StatusTab, number>;
  activeStatusTab: StatusTab;
  onChangeStatusTab: (t: StatusTab) => void;
  selected: PostCandidate | null;
  onSelect: (id: string) => void;
  notes: string;
  savedNotes: string;
  onChangeNotes: (v: string) => void;
  onSaveNotes: () => void | Promise<void>;
  onDecide: (s: DecisionStatus) => void;
  onApproveAnyway?: () => void;
  activeDetailTab: DetailTab;
  onChangeDetailTab: (t: DetailTab) => void;
  mobileSheet: MobileSheet;
  onChangeSheet: (s: MobileSheet) => void;
  filters: ReviewFilters;
  onChangeFilters: (f: ReviewFilters) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  loading: boolean;
  onRefresh: () => void;
  onRefreshQueue?: () => void;
  onSwipeNext: () => void;
  onSwipePrev: () => void;
  media: CandidateMediaState;
  onRegisterActivateStream?: (activate: () => void) => void;
  firstThumbnailById?: Readonly<Record<string, string | null>>;
  onCandidateUpdated?: (c: PostCandidate) => void;
  onVariantCreated?: (c: PostCandidate) => void;
  onSpawnCreated?: (c: PostCandidate) => void | Promise<void>;
  onGoToSpawnInReview?: (c: PostCandidate) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  deciding?: boolean;
  savingNotes?: boolean;
  onGenerateCandidates: () => void | Promise<void>;
  generatingCandidates?: boolean;
  generateDisabled?: boolean;
  publishingItems?: PublishingQueueItem[];
  publishingLoading?: boolean;
  publishingActingJobId?: string | null;
  publishingFeedbackByJobId?: Record<string, import('@/lib/publishing-publish-feedback').PublishNowFeedback>;
  publishingPublishActingJobId?: string | null;
  onSchedulePublish?: (jobId: string, iso: string) => void | Promise<void>;
  onUnschedulePublish?: (jobId: string) => void | Promise<void>;
  onPublishNow?: (jobId: string) => void | Promise<void>;
  onUnstagePublish?: (jobId: string) => void | Promise<void>;
  onRefreshPublishing?: () => void;
}) {
  // Caption isn't a tab on mobile (it's inline). Coerce when the sheet opens from caption.
  const sheetTab: MobileDetailSheetTab =
    activeDetailTab === 'debug'
      ? 'debug'
      : activeDetailTab === 'transcript'
        ? 'transcript'
        : 'structure';

  const openDetails = () => {
    if (activeDetailTab === 'caption') onChangeDetailTab('structure');
    onChangeSheet('details');
  };

  const handleQueueSelect = useCallback(
    (id: string) => {
      onSelect(id);
      onChangeSheet(null);
    },
    [onSelect, onChangeSheet],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <button
          type="button"
          onClick={() => onChangeSheet('queue')}
          className="cockpit-btn-secondary px-3 py-1.5 text-xs font-medium"
        >
          Inbox · {counts.needs_review}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={generatingCandidates || generateDisabled}
            onClick={() => void onGenerateCandidates()}
            className="cockpit-btn-generate px-2.5 py-1.5 text-[11px] disabled:opacity-50"
          >
            {generatingCandidates ? 'Generating…' : 'Generate New Candidates'}
          </button>
          <button
            type="button"
            onClick={() => onChangeSheet('filters')}
            className={`cockpit-btn-secondary p-1.5 ${
              hasActiveReviewFilters(filters) ? 'border-[var(--accent)] text-[var(--accent)]' : ''
            }`}
            aria-label="Filters"
            title="Filters"
          >
            <IconFilter />
          </button>
        </div>
      </div>

      {!selected && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--muted)]">
          {loading ? 'Loading…' : 'Pick a candidate from the queue.'}
        </div>
      )}

      {selected && (
        <MobileCandidateView
          candidate={selected}
          notes={notes}
          savedNotes={savedNotes}
          onChangeNotes={onChangeNotes}
          onSaveNotes={onSaveNotes}
          onDecide={onDecide}
          onApproveAnyway={onApproveAnyway}
          videoRef={videoRef}
          onOpenDetails={openDetails}
          onSwipeNext={onSwipeNext}
          onSwipePrev={onSwipePrev}
          media={media}
          onRegisterActivateStream={onRegisterActivateStream}
          onCandidateUpdated={onCandidateUpdated}
          onVariantCreated={onVariantCreated}
          onSpawnCreated={onSpawnCreated}
          onGoToSpawnInReview={onGoToSpawnInReview}
          onRemoveReviewAsset={onRemoveReviewAsset}
          onRegenerate={onRegenerate}
          regenerating={regenerating}
          deciding={deciding}
          savingNotes={savingNotes}
          onRefreshQueue={onRefreshQueue}
          onDelete={onDelete}
          deleting={deleting}
        />
      )}

      <BottomSheet
        open={mobileSheet === 'queue'}
        onClose={() => onChangeSheet(null)}
        title="Queue"
      >
        <CandidateQueueSidebar
          queueCandidates={queueCandidates}
          counts={counts}
          activeTab={activeStatusTab}
          onChangeTab={onChangeStatusTab}
          selectedId={selected?.id ?? null}
          onSelect={handleQueueSelect}
          loading={loading}
          firstThumbnailById={firstThumbnailById}
          publishingItems={publishingItems}
          publishingLoading={publishingLoading}
          publishingActingJobId={publishingActingJobId}
          publishingFeedbackByJobId={publishingFeedbackByJobId}
          publishingPublishActingJobId={publishingPublishActingJobId}
          onSchedulePublish={onSchedulePublish}
          onUnschedulePublish={onUnschedulePublish}
          onPublishNow={onPublishNow}
          onUnstagePublish={onUnstagePublish}
          onRefreshPublishing={onRefreshPublishing}
        />
      </BottomSheet>

      <BottomSheet
        open={mobileSheet === 'details'}
        onClose={() => onChangeSheet(null)}
        title="Details"
      >
        {selected && (
          <div className="flex min-h-0 flex-1 flex-col">
            <nav className="flex shrink-0 border-b border-[var(--border)] text-xs">
              {MOBILE_DETAIL_SHEET_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeDetailTab(t.id)}
                  className={`flex-1 border-b-2 px-3 py-2 transition-colors ${
                    sheetTab === t.id
                      ? 'border-[var(--accent)] text-[var(--text)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="scrollbar-thin flex-1 overflow-auto p-4">
              {sheetTab === 'structure' && (
                <StructureTab
                  candidate={selected}
                  mediaFiles={media.files}
                  onCandidateUpdated={onCandidateUpdated}
                />
              )}
              {sheetTab === 'transcript' && <TranscriptTab candidate={selected} />}
              {sheetTab === 'debug' && <DebugTab candidate={selected} />}
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={mobileSheet === 'filters'}
        onClose={() => onChangeSheet(null)}
        title="Filters"
      >
        <div className="scrollbar-thin overflow-auto p-4">
          <FilterForm filters={filters} onChange={onChangeFilters} />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onRefresh();
                onChangeSheet(null);
              }}
              className="rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)]"
            >
              Apply
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function MobileCandidateView({
  candidate,
  notes,
  savedNotes,
  onChangeNotes,
  onSaveNotes,
  onDecide,
  onApproveAnyway,
  videoRef,
  onOpenDetails,
  onSwipeNext,
  onSwipePrev,
  media,
  onRegisterActivateStream,
  onCandidateUpdated,
  onVariantCreated,
  onSpawnCreated,
  onGoToSpawnInReview,
  onRemoveReviewAsset,
  onRegenerate,
  regenerating,
  deciding,
  savingNotes,
  onRefreshQueue,
  onDelete,
  deleting,
}: {
  candidate: PostCandidate;
  notes: string;
  savedNotes: string;
  onChangeNotes: (v: string) => void;
  onSaveNotes: () => void | Promise<void>;
  onDecide: (s: DecisionStatus) => void;
  onApproveAnyway?: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onOpenDetails: () => void;
  onSwipeNext: () => void;
  onSwipePrev: () => void;
  media: CandidateMediaState;
  onRegisterActivateStream?: (activate: () => void) => void;
  onCandidateUpdated?: (c: PostCandidate) => void;
  onVariantCreated?: (c: PostCandidate) => void;
  onSpawnCreated?: (c: PostCandidate) => void | Promise<void>;
  onGoToSpawnInReview?: (c: PostCandidate) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
  deciding?: boolean;
  savingNotes?: boolean;
  onRefreshQueue?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const dirty = (notes ?? '') !== (savedNotes ?? '');
  const locked = isLockedReviewCandidate(candidate.status);
  const notesNonEmpty = (notes ?? '').trim().length > 0 || (savedNotes ?? '').trim().length > 0;
  const showRegenerate =
    !!onRegenerate &&
    !locked &&
    (candidate.status === 'needs_rewrite' || notesNonEmpty);
  const regenerateDisabled =
    !!regenerating ||
    (candidate.status === 'needs_rewrite' && !notesNonEmpty);
  const { files, loading, error } = media;
  const firstVideoIdx = files.findIndex((f) => f.mimeType.startsWith('video/'));
  const canDetachSource = (candidate.source_asset_ids?.length ?? 0) > 0;

  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [assetIndex, setAssetIndex] = useState(0);

  // Reset carousel position when candidate changes.
  useEffect(() => {
    setAssetIndex(0);
    const el = carouselRef.current;
    if (el) el.scrollLeft = 0;
  }, [candidate.id]);

  const onCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setAssetIndex((prev) => (prev === idx ? prev : idx));
  };

  // Page-level swipe between candidates (ignored when touch starts on assets).
  const touchStart = useRef<
    { x: number; y: number; insideAssets: boolean } | null
  >(null);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    const target = e.target as HTMLElement | null;
    const insideAssets = !!target?.closest('[data-mobile-assets]');
    touchStart.current = { x: t.clientX, y: t.clientY, insideAssets };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    if (start.insideAssets) return;
    const tag = document.activeElement?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 60) return;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) onSwipeNext();
    else onSwipePrev();
  };

  const assetCountLabel = useMemo(() => {
    if (loading || error) return null;
    if (files.length === 0) return null;
    return `${files.length} asset${files.length > 1 ? 's' : ''}`;
  }, [files.length, loading, error]);

  return (
    <div
      className="scrollbar-thin flex flex-1 flex-col overflow-y-auto"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <section className="space-y-2 px-4 pb-3 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <PostTypeBadge postType={candidate.post_type} />
          <StatusPill status={candidate.status} />
          {assetCountLabel && <MetaChip>{assetCountLabel}</MetaChip>}
          {candidate.candidate_date && <MetaChip>{candidate.candidate_date}</MetaChip>}
        </div>
        <h2 className="text-lg font-semibold leading-snug text-[var(--text)]">
          {candidate.title || '(untitled)'}
        </h2>
        <PublishingPrepCard
          candidate={candidate}
          reviewDriveFolderUrl={candidate.review_drive_folder_url}
          onRefreshQueue={onRefreshQueue}
        />
        {candidate.post_type === 'reel' && (
          <ProductionJobCard
            candidate={candidate}
            media={media}
            onVariantCreated={onVariantCreated}
            onCandidateUpdated={onCandidateUpdated}
            onRemoveReviewAsset={onRemoveReviewAsset}
          />
        )}
        {candidate.hook && (
          <p className="text-sm leading-relaxed text-[var(--muted)]">{candidate.hook}</p>
        )}
        <ScoreStrip candidate={candidate} compact />
        {candidate.concept_summary && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
            {candidate.concept_summary}
          </p>
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

      <section data-mobile-assets className="relative bg-[var(--bg)]">
        {loading && (
          <p className="py-12 text-center text-sm text-[var(--muted)]">Loading media…</p>
        )}
        {!loading && error && (
          <p className="px-4 py-12 text-center text-sm text-[var(--bad)]">{error}</p>
        )}
        {!loading && !error && files.length === 0 && (
          <p className="py-12 text-center text-sm text-[var(--muted)]">
            No media in review folder.
          </p>
        )}
        {!loading && !error && files.length > 0 && (
          <>
            <div
              ref={carouselRef}
              onScroll={onCarouselScroll}
              className="scrollbar-thin flex w-full snap-x-mandatory overflow-x-auto"
            >
              {files.map((f, i) => {
                const showTrash = !!onRemoveReviewAsset && canDetachSource;
                return (
                  <div
                    key={f.id}
                    className="snap-start-always relative flex aspect-square w-full shrink-0 items-center justify-center"
                  >
                    {showTrash && (
                      <ReviewMediaTrashButton file={f} onRemove={onRemoveReviewAsset} />
                    )}
                    <MainMediaPreview
                      file={f}
                      candidateId={candidate.id}
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
            {files.length > 1 && (
              <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
                {assetIndex + 1} / {files.length}
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-3 px-4 py-4">
        <CaptionTab candidate={candidate} onCandidateUpdated={onCandidateUpdated} />
      </section>

      <section className="space-y-2 px-3 pb-2">
        {candidate.invalidated_at && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--text)]">Invalidated</span>
            {candidate.invalidation_reason ? `: ${candidate.invalidation_reason}` : ''}
          </div>
        )}
        {candidate.asset_conflict_summary && (
          <div
            className={`rounded-md border px-2 py-1.5 text-[11px] ${
              candidate.has_asset_conflict === true
                ? 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-[var(--bad)]'
                : 'border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]'
            }`}
          >
            {candidate.asset_conflict_summary}
          </div>
        )}
        {candidate.freshness_warning && (
          <div className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1.5 text-[11px] text-[var(--warn)]">
            {candidate.freshness_warning}
          </div>
        )}
        {candidate.collision_summary &&
          ['blocked', 'high', 'medium'].includes((candidate.collision_risk ?? '').trim()) && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--muted)]">
              <span className="font-semibold capitalize text-[var(--text)]">
                {candidate.collision_risk}
              </span>
              : {candidate.collision_summary}
            </div>
          )}
        <div className="flex items-stretch gap-2">
          <DecisionButtons
            onDecide={onDecide}
            size="lg"
            variant="iconOnly"
            disabled={locked || deciding}
            approveDisabled={
              ['blocked', 'high'].includes((candidate.collision_risk ?? '').trim())
            }
            allDecisionsDisabled={Boolean(candidate.invalidated_at)}
          />
          {!locked && (
            <StagePublishingButton candidate={candidate} onStaged={onRefreshQueue} />
          )}
          {onDelete && (
            <DeleteCandidateButton
              onDelete={onDelete}
              size="lg"
              variant="iconOnly"
              disabled={Boolean(deleting) || locked || Boolean(candidate.invalidated_at)}
            />
          )}
        </div>
        {onApproveAnyway &&
          !locked &&
          ['blocked', 'high'].includes((candidate.collision_risk ?? '').trim()) &&
          !candidate.invalidated_at && (
            <button
              type="button"
              onClick={() => onApproveAnyway()}
              className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-[11px] font-semibold text-[var(--muted)]"
            >
              Approve anyway
            </button>
          )}
      </section>

      {'published_meta' in candidate && candidate.status === 'posted' && (
        <section className="px-3 pb-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Instagram performance
            </h3>
            <div className="mt-2">
              <PublishedFeedbackStrip
                feedback={
                  (candidate as PostCandidate & { published_meta?: import('../types').PublishedCandidateMeta })
                    .published_meta?.feedback
                }
                permalink={
                  (candidate as PostCandidate & { published_meta?: import('../types').PublishedCandidateMeta })
                    .published_meta?.instagram_permalink
                }
                publishedAt={
                  (candidate as PostCandidate & { published_meta?: import('../types').PublishedCandidateMeta })
                    .published_meta?.published_at
                }
              />
            </div>
          </div>
        </section>
      )}

      <section className="px-3 pb-2">
        <CandidateIterationPanel
          candidate={candidate}
          onSpawned={onSpawnCreated}
          onGoToReview={onGoToSpawnInReview}
        />
      </section>

      {!locked && (
      <section className="px-3 pb-2">
        <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Reviewer&rsquo;s Notes
            </h3>
            {dirty && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--warn)]">
                Unsaved
              </span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => onChangeNotes(e.target.value)}
            placeholder="Add a note before deciding…"
            className="min-h-[64px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm placeholder:text-[var(--muted)]"
          />
          <RewriteChips onAppend={(t) => onChangeNotes(appendNote(notes, t))} />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!dirty || savingNotes}
              onClick={() => void onSaveNotes()}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
          </div>
          {showRegenerate && (
            <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={regenerateDisabled}
                  onClick={() => void onRegenerate?.()}
                  title={
                    candidate.status === 'needs_rewrite' && !notesNonEmpty
                      ? 'Add reviewer notes first'
                      : 'Re-run the planner using current assets and reviewer notes'
                  }
                  className="rounded-md border border-[var(--warn)] bg-[var(--warn)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--warn)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {regenerating ? 'Regenerating…' : 'Regenerate Candidate'}
                </button>
              </div>
              {(candidate.regeneration_count ?? 0) > 0 && (
                <p className="text-right text-[10px] text-[var(--muted)]">
                  Regenerated {candidate.regeneration_count}×
                  {formatRelativeFromNow(candidate.last_regenerated_at) &&
                    ` · ${formatRelativeFromNow(candidate.last_regenerated_at)}`}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
      )}

      <section className="px-3 pb-6">
        <button
          type="button"
          onClick={onOpenDetails}
          className="w-full rounded-md border border-[var(--border)] py-2 text-sm text-[var(--muted)]"
        >
          See details
        </button>
      </section>
    </div>
  );
}
