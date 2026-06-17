'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { parseHashtagInput, truncateInstagramCaption } from '@/app/content/publishing/publishingCaptionUtils';

type PostAsReelSuccess = {
  candidate_id: string;
  publishing_job_id: string;
  message: string;
  dispatched: boolean;
};

export function PostAsReelModal({
  open,
  assetId,
  assetLabel,
  onClose,
  onDone,
}: {
  open: boolean;
  assetId: string | null;
  assetLabel?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [captionFr, setCaptionFr] = useState('');
  const [hashtagsRaw, setHashtagsRaw] = useState('');
  const [trialReel, setTrialReel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<PostAsReelSuccess | null>(null);

  useEffect(() => {
    if (!open) return;
    setCaptionFr('');
    setHashtagsRaw('');
    setTrialReel(false);
    setErr(null);
    setSuccess(null);
    setSubmitting(false);
  }, [open, assetId]);

  if (!open || !assetId) return null;

  async function submit() {
    const caption = captionFr.trim();
    if (!caption) {
      setErr('Caption is required.');
      return;
    }

    setSubmitting(true);
    setErr(null);
    try {
      const hashtags = parseHashtagInput(hashtagsRaw);
      const res = await fetch(`/api/content-assets/${assetId}/post-as-reel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          caption_fr: truncateInstagramCaption(caption),
          hashtags,
          trial_reel: trialReel,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        candidate_id?: string;
        publishing_job_id?: string;
        message?: string;
        dispatched?: boolean;
      };
      if (!res.ok) {
        const e = j.error;
        if (typeof e === 'string') {
          setErr(e);
        } else if (e && typeof e === 'object') {
          setErr(JSON.stringify(e));
        } else {
          setErr('Request failed');
        }
        return;
      }
      if (!j.candidate_id || !j.publishing_job_id) {
        setErr('Unexpected response from server');
        return;
      }
      setSuccess({
        candidate_id: j.candidate_id,
        publishing_job_id: j.publishing_job_id,
        message:
          typeof j.message === 'string' && j.message.trim()
            ? j.message.trim()
            : 'Reel publish pipeline started.',
        dispatched: j.dispatched ?? false,
      });
      onDone();
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-[var(--text)]">Post as reel</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Publish this library video to Instagram as a reel.
          {assetLabel ? (
            <>
              {' '}
              <span className="font-medium text-[var(--text)]">{assetLabel}</span>
            </>
          ) : null}
        </p>

        {success ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-[var(--good)]">{success.message}</p>
            {!success.dispatched ? (
              <p className="text-[var(--muted)]">
                GitHub worker dispatch was unavailable; the scheduled worker will still pick this up
                within a few minutes.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/content/publishing/${encodeURIComponent(success.publishing_job_id)}`}
                className="rounded border border-[var(--accent)] px-3 py-1.5 text-[var(--accent)] underline"
              >
                View publishing job
              </Link>
              <Link
                href={`/content/review?candidate=${encodeURIComponent(success.candidate_id)}`}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--muted)] underline"
              >
                Open in review
              </Link>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="mt-4 block text-sm text-[var(--muted)]">
              Caption
              <textarea
                className="mt-1 min-h-[120px] w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)]"
                value={captionFr}
                onChange={(e) => setCaptionFr(e.target.value)}
                rows={5}
                placeholder="French caption for Instagram…"
                disabled={submitting}
              />
            </label>

            <label className="mt-3 block text-sm text-[var(--muted)]">
              Hashtags
              <textarea
                className="mt-1 min-h-[72px] w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)]"
                value={hashtagsRaw}
                onChange={(e) => setHashtagsRaw(e.target.value)}
                rows={3}
                placeholder="One per line or comma-separated (no # required)"
                disabled={submitting}
              />
            </label>

            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={trialReel}
                disabled={submitting}
                onChange={(e) => setTrialReel(e.target.checked)}
              />
              <span>
                <span className="font-medium">Trial reel</span>
                <span className="mt-0.5 block text-[var(--muted)]">
                  Share to non-followers first. Auto-graduates to your full audience if it performs
                  well.
                </span>
              </span>
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
                {submitting ? 'Posting…' : 'Post reel now'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
