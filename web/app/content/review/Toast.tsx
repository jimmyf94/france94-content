'use client';

import { useEffect } from 'react';

export type ToastState = { kind: 'good' | 'bad'; msg: string };

export function Toast({
  toast,
  onDone,
}: {
  toast: ToastState | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDone, 2200);
    return () => clearTimeout(id);
  }, [toast, onDone]);

  if (!toast) return null;
  const tone =
    toast.kind === 'good'
      ? 'border-[var(--good)] text-[var(--good)]'
      : 'border-[var(--bad)] text-[var(--bad)]';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-[var(--surface)] px-4 py-2 text-sm shadow-lg ${tone}`}
    >
      {toast.msg}
    </div>
  );
}
