'use client';

import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from './types';

type ProductionJobDto = {
  id: string;
  status: string;
  production_type: string;
  output_video_url: string | null;
  error_message: string | null;
  render_strategy: string | null;
  updated_at: string | null;
};

export function ProductionJobCard({ candidate }: { candidate: PostCandidate }) {
  const [job, setJob] = useState<ProductionJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/production-jobs/by-candidate/${encodeURIComponent(candidate.id)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (res.status === 404) {
        setJob(null);
        return;
      }
      const json = await readJsonResponse<{ job?: ProductionJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setJob(json.job ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [candidate.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (candidate.post_type !== 'reel') return null;

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 lg:px-6">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Reel production (draft)
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
        FFmpeg draft MP4 in public storage. Re-run from repo:{' '}
        <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[10px]">npm run render:reels</code>
      </p>

      {loading && <p className="mt-2 text-xs text-[var(--muted)]">Loading production job…</p>}
      {error && <p className="mt-2 text-xs text-[var(--bad)]">{error}</p>}

      {!loading && !job && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          No production job yet. Approve this reel candidate to queue a job, then run{' '}
          <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[10px]">npm run render:reels</code>.
        </p>
      )}

      {job && (
        <div className="mt-3 space-y-2">
          <p className="text-xs">
            <span className="text-[var(--muted)]">Status:</span>{' '}
            <span className="font-medium text-[var(--text)]">{job.status}</span>
            {job.render_strategy ?
              <>
                {' '}
                <span className="text-[var(--muted)]">·</span> {job.render_strategy}
              </>
            : null}
          </p>
          {job.error_message && (
            <p className="text-xs text-[var(--bad)] whitespace-pre-wrap">{job.error_message}</p>
          )}
          {job.status === 'produced' && job.output_video_url && (
            <div>
              <video
                src={job.output_video_url}
                controls
                playsInline
                className="mt-2 max-h-80 max-w-full rounded-md border border-[var(--border)] bg-black"
              />
              <a
                href={job.output_video_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-[var(--accent)] underline hover:opacity-80"
              >
                Open rendered MP4
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
