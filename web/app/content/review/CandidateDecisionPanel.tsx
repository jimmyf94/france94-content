'use client';

import { DeleteCandidateButton } from './decision/DeleteCandidateButton';
import { DecisionButtons } from './decision/DecisionButtons';
import { RewriteChips } from './decision/RewriteChips';
import { CandidateTabs } from './tabs/CandidateTabs';
import type { DecisionStatus, DetailTab, PostCandidate } from './types';

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

export function CandidateDecisionPanel({
  candidate,
  notes,
  savedNotes,
  onChangeNotes,
  onSaveNotes,
  onDecide,
  onApproveAnyway,
  activeTab,
  onChangeTab,
  onCandidateUpdated,
  onRegenerate,
  regenerating,
  onDelete,
  deleting,
}: {
  candidate: PostCandidate | null;
  notes: string;
  savedNotes: string;
  onChangeNotes: (v: string) => void;
  onSaveNotes: () => void | Promise<void>;
  onDecide: (s: DecisionStatus) => void;
  onApproveAnyway?: () => void;
  activeTab: DetailTab;
  onChangeTab: (t: DetailTab) => void;
  onCandidateUpdated?: (c: PostCandidate) => void;
  onRegenerate?: () => void | Promise<void>;
  regenerating?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
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
    !!regenerating ||
    (candidate.status === 'needs_rewrite' && !notesNonEmpty);

  return (
    <aside className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="shrink-0 space-y-3 border-b border-[var(--border)] bg-[var(--surface)] p-4">
        {candidate.invalidated_at && (
          <div
            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]"
            role="status"
          >
            <span className="font-semibold text-[var(--text)]">Invalidated</span>
            {candidate.invalidation_reason ? `: ${candidate.invalidation_reason}` : ''}
          </div>
        )}
        {candidate.has_asset_conflict === true && candidate.asset_conflict_summary && (
          <div
            className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2 text-xs text-[var(--bad)]"
            role="status"
          >
            <span className="font-semibold">Asset conflict</span>: {candidate.asset_conflict_summary}
          </div>
        )}
        {candidate.freshness_warning && (
          <div
            className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-xs text-[var(--warn)]"
            role="status"
          >
            {candidate.freshness_warning}
            {candidate.is_fresh_story === false && (
              <span className="mt-1 block text-[10px] text-[var(--muted)]">
                is_fresh_story: false
              </span>
            )}
          </div>
        )}
        {candidate.collision_summary &&
          ['blocked', 'high', 'medium'].includes((candidate.collision_risk ?? '').trim()) && (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                candidate.collision_risk === 'blocked'
                  ? 'border-[var(--bad)]/40 bg-[var(--bad)]/10 text-[var(--bad)]'
                  : candidate.collision_risk === 'high'
                    ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              }`}
              role="status"
            >
              <span className="font-semibold capitalize">
                Content risk: {candidate.collision_risk}
              </span>
              : {candidate.collision_summary}
            </div>
          )}
        <DecisionButtons
          onDecide={onDecide}
          layout="column"
          size="lg"
          disabled={candidate.status === 'ready_to_publish'}
          approveDisabled={
            candidate.has_asset_conflict === true ||
            Boolean(candidate.freshness_warning) ||
            ['blocked', 'high'].includes((candidate.collision_risk ?? '').trim())
          }
          allDecisionsDisabled={Boolean(candidate.invalidated_at)}
        />
        {onApproveAnyway &&
          ['blocked', 'high'].includes((candidate.collision_risk ?? '').trim()) &&
          candidate.has_asset_conflict !== true &&
          !candidate.invalidated_at &&
          candidate.status !== 'ready_to_publish' && (
            <button
              type="button"
              onClick={() => onApproveAnyway()}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              Approve anyway (override collision warning)
            </button>
          )}
        {onDelete && (
          <DeleteCandidateButton
            onDelete={onDelete}
            size="lg"
            disabled={
              Boolean(deleting) ||
              candidate.status === 'ready_to_publish' ||
              Boolean(candidate.invalidated_at)
            }
          />
        )}
        <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
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
            className="min-h-[72px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm placeholder:text-[var(--muted)]"
          />
          <RewriteChips onAppend={(t) => onChangeNotes(appendNote(notes, t))} />
          <div className="flex items-center justify-end">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => void onSaveNotes()}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save notes
            </button>
          </div>
          {showRegenerate && (
            <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  disabled={regenerateDisabled}
                  onClick={() => void onRegenerate?.()}
                  title={
                    candidate.status === 'needs_rewrite' && !notesNonEmpty
                      ? 'Add reviewer notes first'
                      : 'Re-run the planner using current assets and reviewer notes'
                  }
                  className="rounded-md border border-[var(--warn)] bg-[var(--warn)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--warn)] transition-colors hover:bg-[var(--warn)]/20 disabled:cursor-not-allowed disabled:opacity-40"
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
        </section>
      </div>

      <CandidateTabs
        candidate={candidate}
        active={activeTab}
        onChange={onChangeTab}
        onCandidateUpdated={onCandidateUpdated}
      />
    </aside>
  );
}
