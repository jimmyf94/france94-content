'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PublishingJobDto } from '../../review/PublishingPrepCard';

type CandidateBrief = {
  id: string;
  title: string | null;
  post_type: string;
  status: string;
  review_drive_folder_url: string | null;
};

export function PublishingDetailClient({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<PublishingJobDto | null>(null);
  const [candidate, setCandidate] = useState<CandidateBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}`, {
        credentials: 'include',
      });
      const json = await readJsonResponse<{
        job?: PublishingJobDto;
        candidate?: CandidateBrief;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setJob(json.job ?? null);
      setCandidate(json.candidate ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshGraph = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(jobId)}/refresh-status`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.job) setJob(json.job as PublishingJobDto);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const media =
    job?.prepared_media?.length ?
      [...job.prepared_media].sort((a, b) => a.order - b.order)
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-[var(--text)]">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/content/review"
          className="text-sm text-[var(--accent)] underline hover:opacity-80"
        >
          Back to review
        </Link>
      </div>

      <h1 className="text-xl font-semibold tracking-tight">Publishing prep</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Instagram permalink is only available after publish. Review prepared media and container
        status here.
      </p>

      {loading && <p className="mt-6 text-sm text-[var(--muted)]">Loading…</p>}
      {error && (
        <p className="mt-6 text-sm text-[var(--bad)]">{error}</p>
      )}

      {!loading && job && (
        <div className="mt-6 space-y-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Candidate
            </p>
            <p className="mt-1 text-lg font-medium">{candidate?.title || '(untitled)'}</p>
            <p className="text-xs text-[var(--muted)]">
              {candidate?.post_type} · {candidate?.status}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium">
              {job.status}
            </span>
            <span className="text-xs text-[var(--muted)]">{job.publish_type}</span>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshGraph()}
              className="rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh Graph API status'}
            </button>
          </div>

          {job.error_message && (
            <div className="rounded-md border border-[var(--bad)] bg-[var(--bad)]/10 p-3 text-sm text-[var(--bad)] whitespace-pre-wrap">
              {job.error_message}
            </div>
          )}

          {job.caption && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Caption
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{job.caption}</p>
            </div>
          )}

          {media.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Prepared media
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                {media.map((m, i) =>
                  m.media_type === 'video' ?
                    <video
                      key={`${m.public_url}-${i}`}
                      src={m.public_url}
                      controls
                      className="max-h-64 max-w-full rounded-lg border border-[var(--border)] bg-black"
                    />
                  : <a key={`${m.public_url}-${i}`} href={m.public_url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.public_url}
                        alt=""
                        className="max-h-64 max-w-full rounded-lg border border-[var(--border)] object-contain"
                      />
                    </a>,
                )}
              </div>
              <ul className="mt-3 list-inside list-disc text-sm text-[var(--accent)]">
                {job.public_media_urls?.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="underline hover:opacity-80">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {candidate?.review_drive_folder_url && (
            <a
              href={candidate.review_drive_folder_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-[var(--accent)] underline hover:opacity-80"
            >
              Open source review folder
            </a>
          )}

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs text-[var(--muted)]">
            <p className="break-all text-[var(--text)]">
              children: {job.instagram_child_container_ids?.join(', ') || '—'}
            </p>
            <p className="mt-2 break-all">
              parent: {job.instagram_parent_container_id ?? '—'}
            </p>
            <p className="mt-2 break-all">
              creation: {job.instagram_creation_id ?? '—'}
            </p>
            <p className="mt-2 whitespace-pre-wrap">{job.instagram_container_status ?? ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}
