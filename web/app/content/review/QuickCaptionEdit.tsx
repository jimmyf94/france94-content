'use client';

import { useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from './types';

function parseHashtagInput(raw: string): string[] {
  const parts = raw.split(/[\n,]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim().replace(/^#+/, '');
    if (t) out.push(t);
  }
  return out;
}

export function QuickCaptionEdit({
  candidate,
  onCandidateUpdated,
}: {
  candidate: PostCandidate;
  onCandidateUpdated?: (c: PostCandidate) => void;
}) {
  const [fr, setFr] = useState(candidate.caption_fr ?? '');
  const [tagsRaw, setTagsRaw] = useState(() =>
    (candidate.hashtags ?? [])
      .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
      .join('\n'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFr(candidate.caption_fr ?? '');
    setTagsRaw(
      (candidate.hashtags ?? [])
        .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
        .join('\n'),
    );
    setError(null);
  }, [candidate.id, candidate.caption_fr, candidate.hashtags]);

  const savedTagsStr = useMemo(
    () =>
      (candidate.hashtags ?? [])
        .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
        .join('\n'),
    [candidate.hashtags],
  );

  const dirty = fr !== (candidate.caption_fr ?? '') || tagsRaw !== savedTagsStr;

  const save = async () => {
    if (!onCandidateUpdated) return;
    setSaving(true);
    setError(null);
    try {
      const hashtags = parseHashtagInput(tagsRaw);
      const res = await fetch(`/api/content-review/candidates/${candidate.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption_fr: fr.trim() === '' ? null : fr,
          hashtags: hashtags.length === 0 ? null : hashtags,
        }),
      });
      const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.candidate) onCandidateUpdated(json.candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cockpit-card space-y-2 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Caption
      </h3>
      {error && <p className="text-xs text-[var(--bad)]">{error}</p>}
      <textarea
        value={fr}
        onChange={(e) => setFr(e.target.value)}
        placeholder="Caption FR…"
        rows={6}
        className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2.5 text-sm leading-relaxed placeholder:text-[var(--muted)]"
      />
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Hashtags
      </label>
      <textarea
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="One hashtag per line"
        rows={5}
        className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2.5 font-mono text-sm leading-relaxed placeholder:text-[var(--muted)]"
      />
      {onCandidateUpdated && (
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--warn)]">Unsaved</span>
          )}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="cockpit-btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save caption'}
          </button>
        </div>
      )}
    </section>
  );
}
