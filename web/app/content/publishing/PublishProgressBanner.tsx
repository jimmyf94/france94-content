'use client';

export function PublishProgressBanner({
  label,
  backgroundHint = false,
}: {
  label: string;
  backgroundHint?: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2">
      <p className="text-xs font-medium text-[var(--warn)]">{label}</p>
      {backgroundHint && (
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">
          You can close this panel; publishing continues in the background.
        </p>
      )}
    </div>
  );
}
