'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from '../types';

type TranscriptAsset = {
  id: string;
  media_type: string | null;
  label: string;
  transcript: string | null;
};

export function TranscriptTab({ candidate }: { candidate: PostCandidate }) {
  const [assets, setAssets] = useState<TranscriptAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/candidates/${candidate.id}/video-transcripts`,
        { credentials: 'include' },
      );
      const json = await readJsonResponse<{ assets?: TranscriptAsset[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      const list = json.assets ?? [];
      setAssets(list);
      const nextDrafts: Record<string, string> = {};
      const nextSaved: Record<string, string> = {};
      for (const a of list) {
        const t = a.transcript ?? '';
        nextDrafts[a.id] = t;
        nextSaved[a.id] = t;
      }
      setDrafts(nextDrafts);
      setSaved(nextSaved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAssets(null);
      setDrafts({});
      setSaved({});
    } finally {
      setLoading(false);
    }
  }, [candidate.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const videos = useMemo(
    () => (assets ?? []).filter((a) => a.media_type === 'video'),
    [assets],
  );

  const saveOne = async (assetId: string) => {
    const text = drafts[assetId] ?? '';
    setSavingId(assetId);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/candidates/${candidate.id}/video-transcripts/${assetId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: text.trim() === '' ? null : text }),
        },
      );
      const json = await readJsonResponse<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setSaved((prev) => ({ ...prev, [assetId]: text }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading transcripts…</p>;
  }

  if (!loading && assets === null) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-[var(--bad)]">{error ?? 'Could not load transcripts.'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No video sources on this candidate. Transcripts apply to video assets only.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {error && <p className="text-[var(--bad)]">{error}</p>}
      {videos.map((a) => {
        const dirty = (drafts[a.id] ?? '') !== (saved[a.id] ?? '');
        return (
          <section
            key={a.id}
            className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                {a.label}
              </h3>
              {dirty && (
                <span className="text-[10px] uppercase tracking-wide text-[var(--warn)]">
                  Unsaved
                </span>
              )}
            </div>
            <textarea
              value={drafts[a.id] ?? ''}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))
              }
              placeholder="No transcript yet. Paste or type here…"
              className="min-h-[120px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm placeholder:text-[var(--muted)]"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!dirty || savingId === a.id}
                onClick={() => void saveOne(a.id)}
                className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingId === a.id ? 'Saving…' : 'Save transcript'}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
