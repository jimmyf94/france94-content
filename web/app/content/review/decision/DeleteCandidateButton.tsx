'use client';

const DELETE_CONFIRM_MSG =
  'Delete this candidate permanently? It will be removed from the database and its Google Drive review folder deleted. This does not use the reject feedback loop.';

function IconTrash({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function DeleteCandidateButton({
  onDelete,
  disabled,
  size = 'md',
  variant = 'default',
}: {
  onDelete: () => void;
  disabled?: boolean;
  size?: 'md' | 'lg';
  variant?: 'default' | 'iconOnly';
}) {
  const padY = size === 'lg' ? 'py-3' : 'py-2.5';
  const iconOnly = variant === 'iconOnly';

  const handleClick = () => {
    if (disabled) return;
    if (!window.confirm(DELETE_CONFIRM_MSG)) return;
    onDelete();
  };

  if (iconOnly) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        aria-label="Delete candidate"
        title="Delete candidate permanently"
        className={`flex shrink-0 items-center justify-center rounded-md border border-[var(--bad)] bg-[var(--bad)] px-3 ${padY} text-black transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100`}
      >
        <IconTrash />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleClick}
      className={`w-full rounded-md border border-[var(--bad)]/50 bg-transparent ${padY} px-3 text-sm font-semibold text-[var(--bad)] transition-colors hover:bg-[var(--bad)]/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`}
    >
      Delete
    </button>
  );
}
