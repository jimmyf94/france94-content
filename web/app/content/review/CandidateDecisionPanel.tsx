'use client';

import { RewriteChips } from './decision/RewriteChips';
import { PublishingPrepCard } from './PublishingPrepCard';
import { QuickCaptionEdit } from './QuickCaptionEdit';
import { CandidateTabs } from './tabs/CandidateTabs';
import type { PostCandidate, ReviewDriveFile } from './types';

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

function WarningBanner({ candidate }: { candidate: PostCandidate }) {
  const items: React.ReactNode[] = [];
  if (candidate.invalidated_at) {
    items.push(
      <div
        key="inv"
        className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--muted)]"
      >
        <span className="font-semibold text-[var(--text)]">Invalidated</span>
        {candidate.invalidation_reason ? `: ${candidate.invalidation_reason}` : ''}
      </div>,
    );
  }
  if (candidate.has_asset_conflict === true && candidate.asset_conflict_summary) {
    items.push(
      <div
        key="conflict"
        className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-2 py-1.5 text-xs text-[var(--bad)]"
      >
        {candidate.asset_conflict_summary}
      </div>,
    );
  }
  if (candidate.freshness_warning) {
    items.push(
      <div
        key="stale"
        className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1.5 text-xs text-[var(--warn)]"
      >
        {candidate.freshness_warning}
      </div>,
    );
  }
  const risk = (candidate.collision_risk ?? '').trim();
  if (candidate.collision_summary && ['blocked', 'high', 'medium'].includes(risk)) {
    items.push(
      <div
        key="risk"
        className={`rounded-md border px-2 py-1.5 text-xs ${
          risk === 'blocked'
            ? 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-[var(--bad)]'
            : risk === 'high'
              ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        }`}
      >
        <span className="font-semibold capitalize">{risk}</span>: {candidate.collision_summary}
      </div>,
    );
  }
  if (items.length === 0) return null;
  return <div className="space-y-1.5">{items}</div>;
}

export function CandidateDecisionPanel({
  candidate,
  mediaFiles,
  notes,
  savedNotes,
  onChangeNotes,
  onSaveNotes,
  onCandidateUpdated,
  onRegenerate,
  regenerating,
  onRefreshQueue,
  activeTab,
  onChangeTab,
}: {
  candidate: PostCandidate | null;
  mediaFiles?: ReviewDriveFile[];
  notes: string;
  savedNotes: string;
  onChangeNotes: (v: string) => void;
  onSaveNotes: () => void | Promise<void>;
  onCandidateUpdated?: (c: PostCandidate) => void;
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
  onRefreshQueue?: () => void;
  activeTab: import('./types').DetailTab;
  onChangeTab: (t: import('./types').DetailTab) => void;
}) {
  if (!candidate) {
    return (
      <aside className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        Select a candidate to review.
      </aside>
    );
  }

  const dirty = (notes ?? '') !== (savedNotes ?? '');
  const notesNonEmpty = (notes ?? '').trim().length > 0 || (savedNotes ?? '').trim().length > 0;
  const showRegenerate =
    !!onRegenerate && (candidate.status === 'needs_rewrite' || notesNonEmpty);
  const regenerateDisabled =
    !!regenerating || (candidate.status === 'needs_rewrite' && !notesNonEmpty);

  return (
    <aside className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="scrollbar-thin shrink-0 space-y-3 overflow-auto border-b border-[var(--border)] p-3">
        <WarningBanner candidate={candidate} />

        <section className="cockpit-card space-y-2.5 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Rewrite / direction
            </h3>
            {dirty && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--warn)]">Unsaved</span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => onChangeNotes(e.target.value)}
            placeholder="What should change? Regenerate uses these notes."
            rows={6}
            className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2.5 text-sm leading-relaxed placeholder:text-[var(--muted)]"
          />
          <RewriteChips onAppend={(t) => onChangeNotes(appendNote(notes, t))} />
          {showRegenerate && (
            <button
              type="button"
              disabled={regenerateDisabled}
              onClick={() => void onRegenerate?.()}
              title={
                candidate.status === 'needs_rewrite' && !notesNonEmpty
                  ? 'Add direction first'
                  : 'Saves notes if needed, then re-runs planner'
              }
              className="cockpit-btn-primary w-full py-2.5 text-sm disabled:opacity-40"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate from notes'}
            </button>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => void onSaveNotes()}
              className="cockpit-btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
            >
              Save notes only
            </button>
            {(candidate.regeneration_count ?? 0) > 0 && (
              <p className="text-[10px] text-[var(--muted)]">
                {candidate.regeneration_count}×
                {formatRelativeFromNow(candidate.last_regenerated_at) &&
                  ` · ${formatRelativeFromNow(candidate.last_regenerated_at)}`}
              </p>
            )}
          </div>
        </section>

        <QuickCaptionEdit candidate={candidate} onCandidateUpdated={onCandidateUpdated} />

        <PublishingPrepCard
          candidate={candidate}
          reviewDriveFolderUrl={candidate.review_drive_folder_url}
          onRefreshQueue={onRefreshQueue}
          compact
        />
      </div>

      <CandidateTabs
        candidate={candidate}
        mediaFiles={mediaFiles}
        active={activeTab}
        onChange={onChangeTab}
        onCandidateUpdated={onCandidateUpdated}
        tabs={['structure', 'transcript', 'debug']}
        hideCaption
      />
    </aside>
  );
}
