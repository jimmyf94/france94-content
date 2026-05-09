'use client';

import { useMemo, useState } from 'react';

import type { PostCandidate, ReviewDriveFile } from './types';

function proxySrc(fileId: string, candidateId: string) {
  return `/api/content-review/drive-file/${encodeURIComponent(fileId)}?candidateId=${encodeURIComponent(candidateId)}`;
}

function mediaKind(mime: string): 'image' | 'video' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

function formatBytes(s: string | null): string {
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaGallery({
  candidate,
  files,
  loading,
  error,
}: {
  candidate: PostCandidate;
  files: ReviewDriveFile[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        Review folder media
      </h4>
      {loading && <p className="text-sm text-[var(--muted)]">Loading media…</p>}
      {error && (
        <p className="text-sm text-[var(--bad)]">
          Could not load folder files: {error}
        </p>
      )}
      {!loading && !error && files.length === 0 && (
        <p className="text-sm text-[var(--muted)]">No files in review folder.</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {files.map((f) => (
          <MediaTile key={f.id} file={f} candidate={candidate} />
        ))}
      </div>
    </div>
  );
}

function MediaTile({ file, candidate }: { file: ReviewDriveFile; candidate: PostCandidate }) {
  const kind = useMemo(() => mediaKind(file.mimeType), [file.mimeType]);
  const proxy = proxySrc(file.id, candidate.id);
  const [imgMode, setImgMode] = useState<'thumb' | 'proxy' | 'broken'>(
    file.thumbnailLink ? 'thumb' : 'proxy',
  );
  const [videoFailed, setVideoFailed] = useState(false);

  async function copyName() {
    try {
      await navigator.clipboard.writeText(file.name);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
      <div className="relative aspect-video w-full overflow-hidden rounded bg-black/40">
        {kind === 'image' && imgMode !== 'broken' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            src={imgMode === 'thumb' && file.thumbnailLink ? file.thumbnailLink : proxy}
            className="h-full w-full object-cover"
            onError={() => {
              if (imgMode === 'thumb') setImgMode('proxy');
              else setImgMode('broken');
            }}
          />
        )}
        {kind === 'image' && imgMode === 'broken' && (
          <div className="flex h-full items-center justify-center text-[var(--muted)]">No preview</div>
        )}
        {kind === 'video' && !videoFailed && (
          <video
            src={proxy}
            controls
            className="h-full w-full object-contain"
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        )}
        {kind === 'video' && videoFailed && file.thumbnailLink && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            src={file.thumbnailLink}
            className="h-full w-full object-cover"
          />
        )}
        {kind === 'video' && videoFailed && !file.thumbnailLink && (
          <div className="flex h-full items-center justify-center px-1 text-center text-[var(--muted)]">
            Video preview unavailable
          </div>
        )}
        {kind === 'other' && (
          <div className="flex h-full items-center justify-center text-[var(--muted)]">File</div>
        )}
      </div>
      <div className="truncate font-medium text-[var(--text)]" title={file.name}>
        {file.name}
      </div>
      <div className="text-[var(--muted)]">{file.mimeType || 'unknown type'}</div>
      {file.size && <div className="text-[var(--muted)]">{formatBytes(file.size)}</div>}
      <div className="flex flex-wrap gap-1">
        {file.webViewLink && (
          <a
            href={file.webViewLink}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline"
          >
            Open in Drive
          </a>
        )}
        <button
          type="button"
          onClick={copyName}
          className="text-[var(--muted)] underline"
        >
          Copy name
        </button>
      </div>
    </div>
  );
}
