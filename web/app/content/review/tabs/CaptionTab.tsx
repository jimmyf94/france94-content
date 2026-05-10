'use client';

import { useState } from 'react';

import type { PostCandidate } from '../types';

async function copyText(text: string): Promise<boolean> {
  // Async Clipboard API: requires a secure context (HTTPS or localhost).
  // Falls back to execCommand for HTTP dev access from a phone on the LAN.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to fallback */
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

export function CaptionTab({ candidate }: { candidate: PostCandidate }) {
  const fr = candidate.caption_fr ?? '';
  const en = candidate.caption_en ?? '';
  const tags = (candidate.hashtags ?? []).map((h) => (h.startsWith('#') ? h : `#${h}`));

  if (!fr && !en && tags.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No captions yet.</p>;
  }

  const allText = [fr, en, tags.join(' ')].filter(Boolean).join('\n\n');

  return (
    <div className="space-y-4 text-sm">
      <div className="flex justify-end">
        <CopyButton getText={() => allText} label="Copy all" />
      </div>
      {fr && (
        <Section title="Caption FR" actions={<CopyButton getText={() => fr} />}>
          <p className="whitespace-pre-wrap leading-relaxed">{fr}</p>
        </Section>
      )}
      {en && (
        <Section title="Caption EN" actions={<CopyButton getText={() => en} />}>
          <p className="whitespace-pre-wrap leading-relaxed">{en}</p>
        </Section>
      )}
      {tags.length > 0 && (
        <Section title="Hashtags" actions={<CopyButton getText={() => tags.join(' ')} />}>
          <p className="break-words text-[var(--accent)]">{tags.join(' ')}</p>
        </Section>
      )}
    </div>
  );
}
