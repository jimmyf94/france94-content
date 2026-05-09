'use client';

import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import { InstructionBlocks, RawJsonAccordion } from './InstructionBlocks';
import { MediaGallery } from './MediaGallery';
import type { PostCandidate, ReviewDriveFile } from './types';

function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const colors = {
    neutral: 'border-[var(--border)] text-[var(--muted)]',
    good: 'border-[var(--good)] text-[var(--good)]',
    warn: 'border-[var(--warn)] text-[var(--warn)]',
    bad: 'border-[var(--bad)] text-[var(--bad)]',
    accent: 'border-[var(--accent)] text-[var(--accent)]',
  }[tone];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colors}`}
    >
      {children}
    </span>
  );
}

function ScoreChip({ label, value }: { label: string; value: number | string | null | undefined }) {
  if (value == null || value === '') return null;
  return (
    <div className="rounded border border-[var(--border)] px-2 py-1 text-center">
      <div className="text-[10px] uppercase text-[var(--muted)]">{label}</div>
      <div className="font-semibold tabular-nums">{String(value)}</div>
    </div>
  );
}

export function CandidateCard({
  candidate,
  selected,
  onSelect,
  onUpdated,
  notes,
  onNotesChange,
}: {
  candidate: PostCandidate;
  selected: boolean;
  onSelect: () => void;
  onUpdated: () => void;
  notes: string;
  onNotesChange: (value: string) => void;
}) {
  const [files, setFiles] = useState<ReviewDriveFile[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMediaLoading(true);
      setMediaError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/files`, {
          credentials: 'include',
        });
        const json = await readJsonResponse<{ files?: ReviewDriveFile[]; error?: string }>(res);
        if (!res.ok) {
          throw new Error(json.error || res.statusText);
        }
        if (!cancelled) {
          setFiles(json.files ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setMediaError(e instanceof Error ? e.message : String(e));
          setFiles([]);
        }
      } finally {
        if (!cancelled) setMediaLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  const patchStatus = useCallback(
    async (status: 'approved' | 'rejected' | 'needs_rewrite') => {
      setSaving(true);
      setLocalErr(null);
      setLocalMsg(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, reviewer_notes: notes }),
        });
        const json = await readJsonResponse<{ error?: string }>(res);
        if (!res.ok) {
          throw new Error(json.error || res.statusText);
        }
        setLocalMsg('Saved.');
        onUpdated();
      } catch (e) {
        setLocalErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [candidate.id, notes, onUpdated],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        void patchStatus('approved');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void patchStatus('rejected');
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        void patchStatus('needs_rewrite');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, patchStatus]);

  async function copyCaption() {
    const t = [candidate.caption_fr, candidate.caption_en].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(t);
      setLocalMsg('Caption copied.');
    } catch {
      setLocalErr('Could not copy caption.');
    }
  }

  const statusTone =
    candidate.status === 'approved'
      ? 'good'
      : candidate.status === 'rejected'
        ? 'bad'
        : candidate.status === 'needs_rewrite'
          ? 'warn'
          : 'neutral';

  return (
    <article
      data-review-card
      tabIndex={0}
      onFocus={onSelect}
      onClick={onSelect}
      className={`rounded-xl border bg-[var(--surface)] p-4 outline-none transition-shadow ${
        selected ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--border)]'
      }`}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{candidate.post_type}</Badge>
            <Badge tone={statusTone}>{candidate.status}</Badge>
            {candidate.candidate_date && (
              <span className="text-xs text-[var(--muted)]">{candidate.candidate_date}</span>
            )}
          </div>
          <h2 className="text-lg font-semibold leading-snug text-[var(--text)]">
            {candidate.title || '(untitled)'}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <ScoreChip label="Priority" value={candidate.priority_score} />
          <ScoreChip label="Mission" value={candidate.mission_score} />
          <ScoreChip label="Human" value={candidate.human_score} />
          <ScoreChip label="Sponsor" value={candidate.sponsor_safety_score} />
          <ScoreChip label="Effort" value={candidate.effort_score} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <MediaGallery
          candidate={candidate}
          files={files}
          loading={mediaLoading}
          error={mediaError}
        />

        <div className="flex flex-col gap-4">
          <div className="lg:sticky lg:top-4 lg:z-10 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="text-xs font-semibold uppercase text-[var(--muted)]">Decision</p>
            <textarea
              className="min-h-[72px] w-full resize-y rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]"
              placeholder="Reviewer notes…"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              onFocus={() => onSelect()}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.stopPropagation();
                  void patchStatus('approved');
                }}
                className="rounded bg-[var(--good)] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.stopPropagation();
                  void patchStatus('rejected');
                }}
                className="rounded border border-[var(--bad)] px-3 py-1.5 text-sm font-medium text-[var(--bad)] disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={(e) => {
                  e.stopPropagation();
                  void patchStatus('needs_rewrite');
                }}
                className="rounded border border-[var(--warn)] px-3 py-1.5 text-sm font-medium text-[var(--warn)] disabled:opacity-50"
              >
                Needs rewrite
              </button>
            </div>
            {localMsg && <p className="text-sm text-[var(--good)]">{localMsg}</p>}
            {localErr && <p className="text-sm text-[var(--bad)]">{localErr}</p>}
            <div className="flex flex-wrap gap-2 text-xs">
              {candidate.review_drive_folder_url && (
                <a
                  href={candidate.review_drive_folder_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open review folder
                </a>
              )}
              <button
                type="button"
                className="text-[var(--muted)] underline"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyCaption();
                }}
              >
                Copy captions
              </button>
            </div>
          </div>

          {candidate.hook && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Hook</h3>
              <p className="text-sm whitespace-pre-wrap">{candidate.hook}</p>
            </section>
          )}

          {candidate.concept_summary && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">
                Concept summary
              </h3>
              <p className="text-sm whitespace-pre-wrap">{candidate.concept_summary}</p>
            </section>
          )}

          <InstructionBlocks candidate={candidate} />

          {candidate.caption_fr && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Caption FR</h3>
              <p className="text-sm whitespace-pre-wrap">{candidate.caption_fr}</p>
            </section>
          )}

          {candidate.caption_en && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Caption EN</h3>
              <p className="text-sm whitespace-pre-wrap">{candidate.caption_en}</p>
            </section>
          )}

          {candidate.hashtags && candidate.hashtags.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Hashtags</h3>
              <p className="text-sm text-[var(--accent)]">
                {candidate.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}
              </p>
            </section>
          )}

          {candidate.rationale && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Rationale</h3>
              <p className="text-sm whitespace-pre-wrap text-[var(--muted)]">{candidate.rationale}</p>
            </section>
          )}

          <RawJsonAccordion label="Raw LLM payload (debug)" value={candidate.llm_raw} />
        </div>
      </div>
    </article>
  );
}
