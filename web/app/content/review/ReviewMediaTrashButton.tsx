'use client';

import type { ReviewDriveFile } from './types';

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
    </svg>
  );
}

export function ReviewMediaTrashButton({
  file,
  onRemove,
}: {
  file: ReviewDriveFile;
  onRemove: (file: ReviewDriveFile) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRemove(file)}
      title={`Remove ${file.name} from this candidate (library asset kept)`}
      className="pointer-events-auto absolute right-1 top-1 z-10 rounded-md bg-black/55 p-1.5 text-[var(--bad)] shadow-sm backdrop-blur-sm transition-opacity hover:bg-black/70 hover:opacity-95"
      aria-label={`Remove ${file.name} from candidate; library asset kept`}
    >
      <TrashIcon className="h-5 w-5" />
    </button>
  );
}
