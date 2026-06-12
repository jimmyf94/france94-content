'use client';

import type { PublishingJobDto } from '@/lib/publishing-types';
import type { ReelTrialGraduationStrategy } from '@/lib/reel-trial-types';

export function canEditReelTrialSettings(job: PublishingJobDto): boolean {
  if (job.publish_type !== 'reel') return false;
  if (job.instagram_creation_id) return false;
  return !['published', 'publishing'].includes(job.status);
}

export function ReelTrialControls({
  job,
  acting,
  onUpdate,
}: {
  job: PublishingJobDto;
  acting: boolean;
  onUpdate: (strategy: ReelTrialGraduationStrategy | null) => void | Promise<void>;
}) {
  if (!canEditReelTrialSettings(job)) return null;

  const enabled = (job.reel_trial_graduation_strategy ?? null) != null;
  const strategy = job.reel_trial_graduation_strategy ?? 'MANUAL';

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          disabled={acting}
          onChange={(e) => {
            void onUpdate(e.target.checked ? strategy : null);
          }}
        />
        <span>
          <span className="font-medium text-[var(--text)]">Trial reel</span>
          <span className="mt-0.5 block text-[var(--muted)]">
            Share to non-followers first — test before your full audience sees it.
          </span>
        </span>
      </label>
      {enabled && (
        <div className="mt-2 pl-5">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Graduation
          </label>
          <select
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text)]"
            value={strategy}
            disabled={acting}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'MANUAL' || v === 'SS_PERFORMANCE') {
                void onUpdate(v);
              }
            }}
          >
            <option value="MANUAL">Graduate manually in Instagram</option>
            <option value="SS_PERFORMANCE">Auto-graduate if it performs well</option>
          </select>
        </div>
      )}
    </div>
  );
}

export function ReelTrialBadge({ job }: { job: PublishingJobDto }) {
  if (job.publish_type !== 'reel' || !job.reel_trial_graduation_strategy) return null;
  return (
    <span className="rounded bg-[var(--warn)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warn)]">
      Trial reel
    </span>
  );
}
