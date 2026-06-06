'use client';

const DELETE_CONFIRM_MSG =
  'Delete this candidate permanently? It will be removed from the database and its Google Drive review folder deleted. This does not use the reject feedback loop.';

export function DeleteCandidateButton({
  onDelete,
  disabled,
  size = 'md',
}: {
  onDelete: () => void;
  disabled?: boolean;
  size?: 'md' | 'lg';
}) {
  const padY = size === 'lg' ? 'py-2.5' : 'py-2';

  const handleClick = () => {
    if (disabled) return;
    if (!window.confirm(DELETE_CONFIRM_MSG)) return;
    onDelete();
  };

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
