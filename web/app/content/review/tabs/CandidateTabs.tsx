'use client';

import type { DetailTab, PostCandidate, ReviewDriveFile } from '../types';

import { CaptionTab } from './CaptionTab';
import { DebugTab } from './DebugTab';
import { StructureTab } from './StructureTab';
import { TranscriptTab } from './TranscriptTab';

const ALL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'caption', label: 'Caption' },
  { id: 'structure', label: 'Structure' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'debug', label: 'Debug' },
];

export function CandidateTabs({
  candidate,
  mediaFiles,
  active,
  onChange,
  onCandidateUpdated,
  tabs,
  hideCaption = false,
}: {
  candidate: PostCandidate;
  mediaFiles?: ReviewDriveFile[];
  active: DetailTab;
  onChange: (t: DetailTab) => void;
  onCandidateUpdated?: (c: PostCandidate) => void;
  tabs?: DetailTab[];
  hideCaption?: boolean;
}) {
  const visibleTabs = ALL_TABS.filter((t) => {
    if (hideCaption && t.id === 'caption') return false;
    if (tabs) return tabs.includes(t.id);
    return true;
  });

  const effectiveActive = visibleTabs.some((t) => t.id === active)
    ? active
    : (visibleTabs[0]?.id ?? 'structure');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 border-b border-[var(--border)] text-xs">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`flex-1 border-b-2 px-2 py-2 transition-colors ${
              effectiveActive === t.id
                ? 'border-[var(--accent)] text-[var(--text)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="scrollbar-thin flex-1 overflow-auto p-3">
        {effectiveActive === 'caption' && (
          <CaptionTab candidate={candidate} onCandidateUpdated={onCandidateUpdated} />
        )}
        {effectiveActive === 'structure' && (
          <StructureTab
            candidate={candidate}
            mediaFiles={mediaFiles}
            onCandidateUpdated={onCandidateUpdated}
          />
        )}
        {effectiveActive === 'transcript' && <TranscriptTab candidate={candidate} />}
        {effectiveActive === 'debug' && <DebugTab candidate={candidate} />}
      </div>
    </div>
  );
}
