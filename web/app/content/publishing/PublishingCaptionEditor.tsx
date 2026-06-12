'use client';

import { useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import {
  hashtagsToInput,
  parseHashtagInput,
} from './publishingCaptionUtils';

type SavedCaption = {
  caption_fr: string | null;
  caption_en: string | null;
  hashtags: string[] | null;
};

export function PublishingCaptionEditor({
  candidateId,
  initialCaptionFr,
  initialCaptionEn,
  initialHashtags,
  compact = true,
  onSaved,
  onCancel,
}: {
  candidateId: string;
  initialCaptionFr: string | null;
  initialCaptionEn: string | null;
  initialHashtags: string[] | null;
  compact?: boolean;
  onSaved: (saved: SavedCaption) => void;
  onCancel: () => void;
}) {
  const [fr, setFr] = useState(initialCaptionFr ?? '');
  const [en, setEn] = useState(initialCaptionEn ?? '');
  const [tagsRaw, setTagsRaw] = useState(() => hashtagsToInput(initialHashtags));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFr(initialCaptionFr ?? '');
    setEn(initialCaptionEn ?? '');
    setTagsRaw(hashtagsToInput(initialHashtags));
    setError(null);
  }, [candidateId, initialCaptionFr, initialCaptionEn, initialHashtags]);

  const savedTagsStr = hashtagsToInput(initialHashtags);
  const dirty =
    fr !== (initialCaptionFr ?? '') ||
    en !== (initialCaptionEn ?? '') ||
    tagsRaw !== savedTagsStr;

  const labelClass = compact
    ? 'text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]'
    : 'text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';

  const inputClass = compact
    ? 'mt-1 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]'
    : 'mt-1 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const hashtags = parseHashtagInput(tagsRaw);
      const res = await fetch(`/api/content-review/candidates/${encodeURIComponent(candidateId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption_fr: fr.trim() === '' ? null : fr,
          caption_en: en.trim() === '' ? null : en,
          hashtags: hashtags.length === 0 ? null : hashtags,
        }),
      });
      const json = await readJsonResponse<{
        candidate?: {
          caption_fr?: string | null;
          caption_en?: string | null;
          hashtags?: string[] | null;
        };
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      onSaved({
        caption_fr: json.candidate?.caption_fr ?? (fr.trim() === '' ? null : fr),
        caption_en: json.candidate?.caption_en ?? (en.trim() === '' ? null : en),
        hashtags:
          json.candidate?.hashtags ?? (hashtags.length === 0 ? null : hashtags),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className={labelClass}>Caption FR</span>
        <textarea
          value={fr}
          onChange={(e) => setFr(e.target.value)}
          rows={compact ? 3 : 4}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Caption EN</span>
        <textarea
          value={en}
          onChange={(e) => setEn(e.target.value)}
          rows={compact ? 2 : 3}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Hashtags</span>
        <textarea
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          rows={compact ? 2 : 3}
          placeholder="One per line"
          className={inputClass}
        />
      </label>

      {error && <p className="text-[11px] text-[var(--bad)]">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="flex-1 rounded-md border border-[var(--accent)] bg-[var(--accent)] px-2 py-1.5 text-[11px] font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save caption'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded-md border border-[var(--border)] px-2 py-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
