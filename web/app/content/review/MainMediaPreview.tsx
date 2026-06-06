'use client';

import { useEffect, useState } from 'react';

import { sizedDriveThumbnail } from '@/lib/drive-thumbnail';

import type { ReviewDriveFile } from './types';

function proxySrc(fileId: string, candidateId: string) {
  return `/api/content-review/drive-file/${encodeURIComponent(fileId)}?candidateId=${encodeURIComponent(candidateId)}`;
}

function drivePreviewSrc(fileId: string) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

function FallbackTile({ file, compact }: { file: ReviewDriveFile; compact: boolean }) {
  const thumb = sizedDriveThumbnail(file.thumbnailLink, compact ? 320 : 800);
  return (
    <div
      className={`flex max-w-md flex-col items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted)] ${
        compact ? 'p-3 text-xs' : 'p-8 text-sm'
      }`}
    >
      <p>Preview unavailable</p>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
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
  videoRef: _videoRef,
  compact = false,
  onRegisterActivateStream,
}: {
  file: ReviewDriveFile;
  candidateId: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  compact?: boolean;
  /** Legacy: spacebar play; videos use Drive embed (no-op). */
  onRegisterActivateStream?: (activate: () => void) => void;
}) {
  const proxy = proxySrc(file.id, candidateId);
  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');
  const previewWidth = compact ? 480 : 800;
  const sizedThumb = sizedDriveThumbnail(file.thumbnailLink, previewWidth);

  const [imgSrc, setImgSrc] = useState<'thumb' | 'proxy' | 'failed'>(
    sizedThumb ? 'thumb' : 'proxy',
  );

  useEffect(() => {
    setImgSrc(sizedThumb ? 'thumb' : 'proxy');
  }, [file.id, sizedThumb]);

  useEffect(() => {
    if (!isVideo || !onRegisterActivateStream) return;
    onRegisterActivateStream(() => {});
    return () => onRegisterActivateStream(() => {});
  }, [isVideo, onRegisterActivateStream]);

  return (
    <figure className="flex h-full max-h-full w-full max-w-full flex-col items-center justify-center gap-1.5">
      <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
        {isImage && imgSrc !== 'failed' && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={file.id}
            src={imgSrc === 'thumb' && sizedThumb ? sizedThumb : proxy}
            alt={file.name}
            loading="lazy"
            decoding="async"
            className="max-h-full max-w-full rounded-lg object-contain"
            onError={() => {
              if (imgSrc === 'thumb' && sizedThumb) setImgSrc('proxy');
              else setImgSrc('failed');
            }}
          />
        )}
        {isImage && imgSrc === 'failed' && <FallbackTile file={file} compact={compact} />}
        {isVideo && file.id && (
          <iframe
            key={`drive-${file.id}`}
            src={drivePreviewSrc(file.id)}
            title={file.name}
            allow="autoplay"
            className={`max-h-full max-w-full rounded-lg border-0 ${
              compact ? 'aspect-square min-h-[8rem] w-full' : 'aspect-video w-full max-w-3xl min-h-[12rem]'
            }`}
          />
        )}
        {isVideo && !file.id && <FallbackTile file={file} compact={compact} />}
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
