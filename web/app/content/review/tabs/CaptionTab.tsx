'use client';

import { useState } from 'react';

import type { PostCandidate } from '../types';

function CopyButton({ getText, label }: { getText: () => string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
    >
      {done ? 'Copied' : (label ?? 'Copy')}
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
