'use client';

import { useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from '../types';

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  const prevSelection = document.getSelection();
  const prevRange =
    prevSelection && prevSelection.rangeCount > 0 ? prevSelection.getRangeAt(0) : null;
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  if (prevSelection && prevRange) {
    prevSelection.removeAllRanges();
    prevSelection.addRange(prevRange);
  }
  return ok;
}

function CopyButton({ getText, label }: { getText: () => string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(getText());
        setState(ok ? 'done' : 'fail');
        setTimeout(() => setState('idle'), 1500);
      }}
      className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
    >
      {state === 'done' ? 'Copied' : state === 'fail' ? 'Failed' : (label ?? 'Copy')}
    </button>
  );
}

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {title}
        </h3>
        {actions}
      </header>
      <div>{children}</div>
    </section>
  );
}

function parseHashtagInput(raw: string): string[] {
  const parts = raw.split(/[\n,]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim().replace(/^#+/, '');
    if (t) out.push(t);
  }
  return out;
}

export function CaptionTab({
  candidate,
  onCandidateUpdated,
}: {
  candidate: PostCandidate;
  onCandidateUpdated?: (c: PostCandidate) => void;
}) {
  const [fr, setFr] = useState(candidate.caption_fr ?? '');
  const [en, setEn] = useState(candidate.caption_en ?? '');
  const [tagsRaw, setTagsRaw] = useState(() =>
    (candidate.hashtags ?? [])
      .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
      .join('\n'),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFr(candidate.caption_fr ?? '');
    setEn(candidate.caption_en ?? '');
    setTagsRaw(
      (candidate.hashtags ?? [])
        .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
        .join('\n'),
    );
    setError(null);
  }, [
    candidate.id,
    candidate.caption_fr,
    candidate.caption_en,
    candidate.hashtags,
  ]);

  const savedTagsStr = useMemo(
    () =>
      (candidate.hashtags ?? [])
        .map((h) => (String(h).startsWith('#') ? String(h).slice(1) : String(h)))
        .join('\n'),
    [candidate.hashtags],
  );

  const dirty =
    fr !== (candidate.caption_fr ?? '') ||
    en !== (candidate.caption_en ?? '') ||
    tagsRaw !== savedTagsStr;

  const tagsForCopy = parseHashtagInput(tagsRaw).map((t) => `#${t}`);
  const allText = [fr, en, tagsForCopy.join(' ')].filter(Boolean).join('\n\n');

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
          caption_en: en.trim() === '' ? null : en,
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
    <div className="space-y-4 text-sm">
      {candidate.post_type === 'carousel' && (
        <p className="rounded border border-[var(--border)] bg-[var(--surface)]/40 px-3 py-2 text-xs text-[var(--muted)]">
          This caption applies to the whole carousel post, not to individual slides.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <CopyButton getText={() => allText} label="Copy all" />
      </div>
      {error && <p className="text-[var(--bad)]">{error}</p>}

      <Section title="Caption FR" actions={<CopyButton getText={() => fr} />}>
        <textarea
          value={fr}
          onChange={(e) => setFr(e.target.value)}
          placeholder="Caption (French)…"
          className="min-h-[72px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm leading-relaxed placeholder:text-[var(--muted)]"
        />
      </Section>

      <Section title="Caption EN" actions={<CopyButton getText={() => en} />}>
        <textarea
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder="Caption (English)…"
          className="min-h-[72px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm leading-relaxed placeholder:text-[var(--muted)]"
        />
      </Section>

      <Section title="Hashtags" actions={<CopyButton getText={() => tagsForCopy.join(' ')} />}>
        <textarea
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="One tag per line (with or without #)"
          className="min-h-[64px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm placeholder:text-[var(--muted)]"
        />
      </Section>

      {onCandidateUpdated && (
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--warn)]">
              Unsaved
            </span>
          )}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save caption & hashtags'}
          </button>
        </div>
      )}
    </div>
  );
}
