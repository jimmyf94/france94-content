'use client';

import { useState } from 'react';

import type { ReviewDriveFile } from './types';

function proxySrc(fileId: string, candidateId: string) {
  return `/api/content-review/drive-file/${encodeURIComponent(fileId)}?candidateId=${encodeURIComponent(candidateId)}`;
}

function FallbackTile({ file, compact }: { file: ReviewDriveFile; compact: boolean }) {
  return (
    <div
      className={`flex max-w-md flex-col items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted)] ${
        compact ? 'p-3 text-xs' : 'p-8 text-sm'
      }`}
    >
      <p>Preview unavailable</p>
      {file.thumbnailLink && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={file.thumbnailLink}
          alt=""
          className={`rounded ${compact ? 'max-h-32' : 'max-h-64'}`}
        />
      )}
      {file.webViewLink && (
        <a
          href={file.webViewLink}
          target="_blank"
          rel="noreferrer"
          className="rounded border border-[var(--border)] px-2 py-1 text-[var(--accent)]"
        >
          Open in Drive
        </a>
      )}
    </div>
  );
}

export function MainMediaPreview({
  file,
  candidateId,
  videoRef,
  compact = false,
}: {
  file: ReviewDriveFile;
  candidateId: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  compact?: boolean;
}) {
  const proxy = proxySrc(file.id, candidateId);
  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');
  const [imgFailed, setImgFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <figure className="flex h-full max-h-full w-full max-w-full flex-col items-center justify-center gap-1.5">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {isImage && !imgFailed && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={file.id}
            src={proxy}
            alt={file.name}
            className="max-h-full max-w-full rounded-lg object-contain"
            onError={() => setImgFailed(true)}
          />
        )}
        {isImage && imgFailed && <FallbackTile file={file} compact={compact} />}
        {isVideo && !videoFailed && (
          <video
            ref={videoRef}
            key={file.id}
            src={proxy}
            controls
            playsInline
            muted
            preload="metadata"
            className="max-h-full max-w-full rounded-lg object-contain"
            onError={() => setVideoFailed(true)}
          />
        )}
        {isVideo && videoFailed && <FallbackTile file={file} compact={compact} />}
        {!isImage && !isVideo && <FallbackTile file={file} compact={compact} />}
      </div>
      {compact ? (
        <figcaption
          className="max-w-full truncate text-[10px] text-[var(--muted)]"
          title={file.name}
        >
          {file.name}
        </figcaption>
      ) : (
        <figcaption className="flex max-w-full items-center justify-center gap-3 text-xs text-[var(--muted)]">
          <span className="max-w-[60ch] truncate" title={file.name}>
            {file.name}
          </span>
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
        </figcaption>
      )}
    </figure>
  );
}
