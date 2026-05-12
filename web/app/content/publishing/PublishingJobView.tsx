'use client';

import type { PublishingJobDto } from '@/lib/publishing-types';

function statusTone(status: string): string {
  if (status === 'ready_to_publish') return 'text-[var(--good)]';
  if (status === 'failed') return 'text-[var(--bad)]';
  if (status === 'processing' || status === 'containers_created') return 'text-[var(--warn)]';
  return 'text-[var(--muted)]';
}

function sortedPreparedMedia(job: PublishingJobDto) {
  if (!job.prepared_media?.length) return [];
  return [...job.prepared_media].sort((a, b) => a.order - b.order);
}

export type PublishingJobViewVariant = 'prepCard' | 'detailPage';

export function PublishingJobView({
  job,
  variant,
  refreshing,
  onRefreshGraph,
  reviewDriveFolderUrl,
}: {
  job: PublishingJobDto;
  variant: PublishingJobViewVariant;
  refreshing: boolean;
  onRefreshGraph: () => void;
  reviewDriveFolderUrl?: string | null;
}) {
  const media = sortedPreparedMedia(job);

  if (variant === 'prepCard') {
    return (
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`font-semibold ${statusTone(job.status)}`}>{job.status}</span>
          <span className="text-[var(--muted)]">·</span>
          <span className="text-[var(--muted)]">{job.publish_type}</span>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void onRefreshGraph()}
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
                    playsInline
                    muted
                    preload={i === 0 ? 'metadata' : 'none'}
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
                      loading="lazy"
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
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium">
          {job.status}
        </span>
        <span className="text-xs text-[var(--muted)]">{job.publish_type}</span>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void onRefreshGraph()}
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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Caption</p>
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

      {reviewDriveFolderUrl && (
        <a
          href={reviewDriveFolderUrl}
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
  );
}
