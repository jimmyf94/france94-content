'use client';

import { CandidateQueueSidebar } from '../CandidateQueueSidebar';
import { DecisionButtons } from '../decision/DecisionButtons';
import { RewriteChips } from '../decision/RewriteChips';
import { FilterForm, type ReviewFilters } from '../FilterDrawer';
import { MainMediaPreview } from '../MainMediaPreview';
import { PostTypeBadge } from '../PostTypeBadge';
import { CandidateTabs } from '../tabs/CandidateTabs';
import type { DecisionStatus, DetailTab, PostCandidate, StatusTab } from '../types';
import { STATUS_TAB_LABEL } from '../types';
import { useCandidateMedia } from '../useCandidateMedia';

import { BottomSheet } from './BottomSheet';

type MobileSheet = null | 'queue' | 'details' | 'filters';

function appendNote(notes: string, chip: string): string {
  return notes.trim() ? `${notes.trim()} · ${chip}` : chip;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    needs_review: 'border-[var(--accent)] text-[var(--accent)]',
    needs_rewrite: 'border-[var(--warn)] text-[var(--warn)]',
    approved: 'border-[var(--good)] text-[var(--good)]',
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

export function MobileReviewStack({
  candidates,
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
  activeDetailTab,
  onChangeDetailTab,
  mobileSheet,
  onChangeSheet,
  filters,
  onChangeFilters,
  videoRef,
  loading,
  onRefresh,
}: {
  candidates: PostCandidate[];
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
  activeDetailTab: DetailTab;
  onChangeDetailTab: (t: DetailTab) => void;
  mobileSheet: MobileSheet;
  onChangeSheet: (s: MobileSheet) => void;
  filters: ReviewFilters;
  onChangeFilters: (f: ReviewFilters) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => onChangeSheet('queue')}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 font-medium"
        >
          Queue · {counts.needs_review}
        </button>
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          FR94 Review
        </span>
        <button
          type="button"
          onClick={() => onChangeSheet('filters')}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--muted)]"
        >
          Filters
        </button>
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
          videoRef={videoRef}
          onOpenDetails={() => onChangeSheet('details')}
        />
      )}

      <BottomSheet
        open={mobileSheet === 'queue'}
        onClose={() => onChangeSheet(null)}
        title="Queue"
      >
        <CandidateQueueSidebar
          candidates={candidates}
          counts={counts}
          activeTab={activeStatusTab}
          onChangeTab={onChangeStatusTab}
          selectedId={selected?.id ?? null}
          onSelect={(id) => {
            onSelect(id);
            onChangeSheet(null);
          }}
          loading={loading}
        />
      </BottomSheet>

      <BottomSheet
        open={mobileSheet === 'details'}
        onClose={() => onChangeSheet(null)}
        title="Details"
      >
        {selected && (
          <CandidateTabs
            candidate={selected}
            active={activeDetailTab}
            onChange={onChangeDetailTab}
          />
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
  videoRef,
  onOpenDetails,
}: {
  candidate: PostCandidate;
  notes: string;
  savedNotes: string;
  onChangeNotes: (v: string) => void;
  onSaveNotes: () => void | Promise<void>;
  onDecide: (s: DecisionStatus) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onOpenDetails: () => void;
}) {
  const dirty = (notes ?? '') !== (savedNotes ?? '');
  const { files, loading, error } = useCandidateMedia(candidate.id);
  const firstVideoIdx = files.findIndex((f) => f.mimeType.startsWith('video/'));

  return (
    <div className="scrollbar-thin flex flex-1 flex-col overflow-y-auto">
      <div className="flex w-full flex-col gap-2 bg-[var(--bg)] p-2">
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
        {!loading &&
          !error &&
          files.map((f, i) => (
            <div
              key={f.id}
              className="flex aspect-square w-full items-center justify-center"
            >
              <MainMediaPreview
                file={f}
                candidateId={candidate.id}
                videoRef={i === firstVideoIdx ? videoRef : undefined}
                compact
              />
            </div>
          ))}
      </div>

      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <PostTypeBadge postType={candidate.post_type} />
          <StatusPill status={candidate.status} />
          {candidate.priority_score != null && (
            <span className="text-xs tabular-nums text-[var(--muted)]">
              P {Number(candidate.priority_score).toFixed(1)}
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold leading-snug">
          {candidate.title || '(untitled)'}
        </h2>
        {candidate.hook && (
          <p className="text-sm leading-relaxed text-[var(--muted)]">{candidate.hook}</p>
        )}
        {(candidate.concept_summary || candidate.rationale) && (
          <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
            {candidate.concept_summary && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Concept
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {candidate.concept_summary}
                </p>
              </div>
            )}
            {candidate.rationale && (
              <details className="group">
                <summary className="flex cursor-pointer items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
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
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 space-y-2 border-t border-[var(--border)] bg-[var(--surface)] p-3">
        <DecisionButtons onDecide={onDecide} size="lg" />
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
              disabled={!dirty}
              onClick={() => void onSaveNotes()}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save notes
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          className="w-full rounded-md border border-[var(--border)] py-2 text-sm text-[var(--muted)]"
        >
          See details (caption, structure, debug)
        </button>
      </div>
    </div>
  );
}
