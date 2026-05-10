'use client';

import { DecisionButtons } from './decision/DecisionButtons';
import { RewriteChips } from './decision/RewriteChips';
import { CandidateTabs } from './tabs/CandidateTabs';
import type { DecisionStatus, DetailTab, PostCandidate } from './types';

function appendNote(notes: string, chip: string): string {
  return notes.trim() ? `${notes.trim()} · ${chip}` : chip;
}

export function CandidateDecisionPanel({
  candidate,
  notes,
  savedNotes,
  onChangeNotes,
  onSaveNotes,
  onDecide,
  activeTab,
  onChangeTab,
}: {
  candidate: PostCandidate | null;
  notes: string;
  savedNotes: string;
  onChangeNotes: (v: string) => void;
  onSaveNotes: () => void | Promise<void>;
  onDecide: (s: DecisionStatus) => void;
  activeTab: DetailTab;
  onChangeTab: (t: DetailTab) => void;
}) {
  if (!candidate) {
    return (
      <aside className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
        Select a candidate to review.
      </aside>
    );
  }

  const dirty = (notes ?? '') !== (savedNotes ?? '');

  return (
    <aside className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="shrink-0 space-y-3 border-b border-[var(--border)] bg-[var(--surface)] p-4">
        <DecisionButtons onDecide={onDecide} layout="column" size="lg" />
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
        </section>
      </div>

      <CandidateTabs candidate={candidate} active={activeTab} onChange={onChangeTab} />
    </aside>
  );
}
