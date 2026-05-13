'use client';

import { useEffect, useState } from 'react';

import type { ManualUsageType } from '@/lib/asset-library-types';

function defaultMarkStale(usage: ManualUsageType): boolean {
  if (usage === 'manual_post' || usage === 'manual_reel') return true;
  return false;
}

export function ManualUsageModal({
  open,
  assetId,
  initialUsage,
  onClose,
  onDone,
}: {
  open: boolean;
  assetId: string | null;
  initialUsage: ManualUsageType;
  onClose: () => void;
  onDone: () => void;
}) {
  const [usage, setUsage] = useState<ManualUsageType>(initialUsage);
  const [occurredAt, setOccurredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [markStale, setMarkStale] = useState(() => defaultMarkStale(initialUsage));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsage(initialUsage);
    setOccurredAt('');
    setNotes('');
    setMarkStale(defaultMarkStale(initialUsage));
    setErr(null);
  }, [open, initialUsage]);

  useEffect(() => {
    setMarkStale(defaultMarkStale(usage));
  }, [usage]);

  if (!open || !assetId) return null;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        usage_type: usage,
        mark_stale: markStale,
        notes: notes.trim() || null,
      };
      if (occurredAt.trim()) {
        body.occurred_at = new Date(occurredAt).toISOString();
      }
      const res = await fetch(`/api/content-assets/${assetId}/manual-usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof j.error === 'string' ? j.error : 'Request failed');
        return;
      }
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-[var(--text)]">Record manual usage</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Outside-system post for this asset.</p>

        <label className="mt-4 block text-sm text-[var(--muted)]">
          Usage type
          <select
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)]"
            value={usage}
            onChange={(e) => setUsage(e.target.value as ManualUsageType)}
          >
            <option value="manual_post">Manual post</option>
            <option value="manual_story">Manual story</option>
            <option value="manual_reel">Manual reel</option>
          </select>
        </label>

        <label className="mt-3 block text-sm text-[var(--muted)]">
          Occurred at (optional, default now)
          <input
            type="datetime-local"
            className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)]"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>

        <label className="mt-3 block text-sm text-[var(--muted)]">
          Notes
          <textarea
            className="mt-1 min-h-[72px] w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </label>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={markStale}
            onChange={(e) => setMarkStale(e.target.checked)}
          />
          Mark as stale / exclude from future candidates
        </label>

        {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
