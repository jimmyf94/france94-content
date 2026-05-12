'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';

import type { PostCandidate } from './types';

export type PublishingJobDto = {
  id: string;
  post_candidate_id: string;
  status: string;
  publish_type: string;
  caption: string | null;
  public_media_urls: string[];
  prepared_media: Array<{
    media_type: string;
    public_url: string;
    order: number;
  }>;
  instagram_child_container_ids: string[];
  instagram_parent_container_id: string | null;
  instagram_creation_id: string | null;
  instagram_container_status: string | null;
  error_message: string | null;
};

function statusTone(status: string): string {
  if (status === 'ready_to_publish') return 'text-[var(--good)]';
  if (status === 'failed') return 'text-[var(--bad)]';
  if (status === 'processing' || status === 'containers_created') return 'text-[var(--warn)]';
  return 'text-[var(--muted)]';
}

export function PublishingPrepCard({
  candidate,
  reviewDriveFolderUrl,
  onRefreshQueue,
}: {
  candidate: PostCandidate;
  reviewDriveFolderUrl: string | null;
  onRefreshQueue?: () => void;
}) {
  const show =
    candidate.status === 'approved' ||
    candidate.status === 'ready_to_publish' ||
    Boolean(candidate.publishing_job_id);

  const [job, setJob] = useState<PublishingJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!candidate.publishing_job_id && candidate.status !== 'approved' && candidate.status !== 'ready_to_publish') {
      setJob(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/by-candidate/${encodeURIComponent(candidate.id)}`,
        { credentials: 'include' },
      );
      if (res.status === 404) {
        setJob(null);
        return;
      }
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setJob(json.job ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [candidate.id, candidate.publishing_job_id, candidate.status]);

  useEffect(() => {
    if (!show) {
      setJob(null);
      return;
    }
    void load();
  }, [show, load]);

  const refreshGraph = async () => {
    if (!job?.id) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/publishing-jobs/${encodeURIComponent(job.id)}/refresh-status`,
        { method: 'POST', credentials: 'include' },
      );
      const json = await readJsonResponse<{ job?: PublishingJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.job) setJob(json.job as PublishingJobDto);
      onRefreshQueue?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (!show) return null;

  const media =
    job?.prepared_media?.length ?
      [...job.prepared_media].sort((a, b) => a.order - b.order)
    : [];

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Publishing prep
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Instagram permalink is only available after publish. Review prepared media and container
            status here. Containers expire after ~24h per Meta.
          </p>
        </div>
        {job?.id && (
          <Link
            href={`/content/publishing/${job.id}`}
            className="shrink-0 text-xs font-medium text-[var(--accent)] underline hover:opacity-80"
          >
            Open publishing detail
          </Link>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-[var(--muted)]">Loading publishing job…</p>}
      {error && (
        <p className="mt-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      )}

      {!loading && !job && !error && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          No publishing job yet. Run{' '}
          <code className="rounded bg-[var(--surface)] px-1 py-0.5 text-[10px]">
            npm run prepare:publishing
          </code>{' '}
          after approving this candidate.
        </p>
      )}

      {job && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`font-semibold ${statusTone(job.status)}`}>{job.status}</span>
            <span className="text-[var(--muted)]">·</span>
            <span className="text-[var(--muted)]">{job.publish_type}</span>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshGraph()}
              className="ml-auto rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh Graph API status'}
            </button>
          </div>

          {job.error_message && (
            <p className="text-xs text-[var(--bad)] whitespace-pre-wrap">{job.error_message}</p>
          )}

          {job.caption && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Caption draft
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text)]">{job.caption}</p>
            </div>
          )}

          {media.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Prepared media
              </p>
              <div className="flex flex-wrap gap-2">
                {media.map((m, i) =>
                  m.media_type === 'video' ?
                    <video
                      key={`${m.public_url}-${i}`}
                      src={m.public_url}
                      controls
                      className="h-28 max-w-[140px] rounded-md border border-[var(--border)] bg-black object-cover"
                    />
                  : <a
                      key={`${m.public_url}-${i}`}
                      href={m.public_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.public_url}
                        alt=""
                        className="h-28 max-w-[140px] rounded-md border border-[var(--border)] object-cover"
                      />
                    </a>,
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {job.public_media_urls?.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] underline hover:opacity-80"
                  >
                    Open prepared media
                  </a>
                ))}
              </div>
            </div>
          )}

          {reviewDriveFolderUrl && (
            <a
              href={reviewDriveFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-[var(--accent)] underline hover:opacity-80"
            >
              Open source review folder
            </a>
          )}

          {(job.instagram_child_container_ids?.length > 0 || job.instagram_creation_id) && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[10px] leading-relaxed text-[var(--muted)]">
              {job.instagram_child_container_ids?.length > 0 && (
                <p className="break-all">
                  <span className="text-[var(--text)]">children:</span>{' '}
                  {job.instagram_child_container_ids.join(', ')}
                </p>
              )}
              {job.instagram_parent_container_id && (
                <p className="mt-1 break-all">
                  <span className="text-[var(--text)]">parent:</span>{' '}
                  {job.instagram_parent_container_id}
                </p>
              )}
              {job.instagram_creation_id && (
                <p className="mt-1 break-all">
                  <span className="text-[var(--text)]">creation:</span>{' '}
                  {job.instagram_creation_id}
                </p>
              )}
              {job.instagram_container_status && (
                <p className="mt-2 text-[var(--text)]">{job.instagram_container_status}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
