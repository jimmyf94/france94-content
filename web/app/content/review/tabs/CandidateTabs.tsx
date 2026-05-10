'use client';

import type { DetailTab, PostCandidate } from '../types';

import { CaptionTab } from './CaptionTab';
import { DebugTab } from './DebugTab';
import { StructureTab } from './StructureTab';

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'caption', label: 'Caption' },
  { id: 'structure', label: 'Structure' },
  { id: 'debug', label: 'Debug' },
];

export function CandidateTabs({
  candidate,
  active,
  onChange,
}: {
  candidate: PostCandidate;
  active: DetailTab;
  onChange: (t: DetailTab) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 border-b border-[var(--border)] text-xs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`flex-1 border-b-2 px-3 py-2 transition-colors ${
              active === t.id
                ? 'border-[var(--accent)] text-[var(--text)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="scrollbar-thin flex-1 overflow-auto p-4">
        {active === 'caption' && <CaptionTab candidate={candidate} />}
        {active === 'structure' && <StructureTab candidate={candidate} />}
        {active === 'debug' && <DebugTab candidate={candidate} />}
      </div>
    </div>
  );
}
