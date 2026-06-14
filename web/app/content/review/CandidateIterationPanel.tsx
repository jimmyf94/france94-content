'use client';

import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate, SpawnMode } from './types';
import { canSpawnFromCandidate, SPAWN_MODE_HINTS, SPAWN_MODE_LABELS, SPAWN_MODES } from './types';

export function CandidateIterationPanel({
  candidate,
  onSpawned,
  onGoToReview,
}: {
  candidate: PostCandidate | null;
  onSpawned?: (c: PostCandidate) => void | Promise<void>;
  onGoToReview?: (c: PostCandidate) => void;
}) {
  const [busyMode, setBusyMode] = useState<SpawnMode | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PostCandidate | null>(null);

  useEffect(() => {
    setCreated(null);
    setError(null);
  }, [candidate?.id]);

  const handleSpawn = useCallback(
    async (mode: SpawnMode) => {
      if (!candidate || busyMode) return;
      setBusyMode(mode);
      setError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/spawn`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            operator_notes: notes.trim(),
            asset_pool: mode === 'shuffle_assets' ? 'same' : 'planner_eligible',
          }),
        });
        const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        if (json.candidate) {
          setCreated(json.candidate);
          await onSpawned?.(json.candidate);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Spawn failed');
      } finally {
        setBusyMode(null);
      }
    },
    [candidate, busyMode, notes, onSpawned],
  );

  if (!candidate || !canSpawnFromCandidate(candidate.status)) {
    return null;
  }

  return (
    <section className="cockpit-card space-y-2.5 p-3">
      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Create more like this
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          Spawns a new candidate in Needs review. The published source stays unchanged.
        </p>
      </div>

      {created && (
        <div className="space-y-2 rounded-md border border-[var(--good)]/40 bg-[var(--good)]/10 px-2.5 py-2">
          <p className="text-xs font-medium text-[var(--text)]">
            Iteration created in Needs review
          </p>
          <p className="line-clamp-2 text-[11px] text-[var(--muted)]">
            {created.title || '(untitled)'}
          </p>
          <button
            type="button"
            onClick={() => onGoToReview?.(created)}
            className="cockpit-btn-primary w-full py-2 text-xs"
          >
            Open in Needs review
          </button>
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Optional direction for the iteration…"
        disabled={!!busyMode}
        className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm placeholder:text-[var(--muted)] disabled:opacity-50"
      />

      <div className="flex flex-col gap-1.5">
        {SPAWN_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={!!busyMode}
            onClick={() => void handleSpawn(mode)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-left hover:border-[var(--accent)] disabled:opacity-50"
          >
            <span className="block text-xs font-medium text-[var(--text)]">
              {busyMode === mode ? 'Creating…' : SPAWN_MODE_LABELS[mode]}
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted)]">
              {SPAWN_MODE_HINTS[mode]}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="text-[11px] text-[var(--bad)]">{error}</p>}
    </section>
  );
}
