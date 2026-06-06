'use client';

import { useCallback, useEffect, useState } from 'react';

type ThumbStage = 'primary' | 'fallback' | 'failed';

function initialStage(thumbnail_link: string | null, fallback: string | null | undefined): ThumbStage {
  if (thumbnail_link) return 'primary';
  if (fallback) return 'fallback';
  return 'failed';
}

export function AssetMediaThumb({
  thumbnail_link,
  poster_url,
  still_url,
  isVideo,
  className = 'h-full w-full object-cover',
  placeholderClassName = 'flex h-full items-center justify-center text-xs text-[var(--muted)]',
}: {
  thumbnail_link: string | null;
  poster_url?: string | null;
  still_url?: string | null;
  isVideo: boolean;
  className?: string;
  placeholderClassName?: string;
}) {
  const fallback = isVideo ? poster_url : still_url;

  const [stage, setStage] = useState<ThumbStage>(() =>
    initialStage(thumbnail_link, fallback),
  );

  useEffect(() => {
    setStage(initialStage(thumbnail_link, fallback));
  }, [thumbnail_link, fallback]);

  const onError = useCallback(() => {
    setStage((s) => {
      if (s === 'primary' && fallback) return 'fallback';
      return 'failed';
    });
  }, [fallback]);

  const src =
    stage === 'primary' ? thumbnail_link : stage === 'fallback' ? fallback : null;

  if (!src || stage === 'failed') {
    return (
      <div className={placeholderClassName}>
        {isVideo ? 'Video (open for preview)' : 'No thumbnail'}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={`${stage}:${src}`}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
      onError={onError}
    />
  );
}
