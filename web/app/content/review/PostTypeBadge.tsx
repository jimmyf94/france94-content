'use client';

import { formatPostTypeLabel, postTypeKey } from './postTypeTheme';

export function PostTypeBadge({
  postType,
  className = '',
}: {
  postType: string;
  className?: string;
}) {
  const k = postTypeKey(postType);
  return (
    <span
      data-post-type={k}
      className={`post-type-badge inline-flex max-w-full shrink-0 items-center truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {formatPostTypeLabel(postType)}
    </span>
  );
}
