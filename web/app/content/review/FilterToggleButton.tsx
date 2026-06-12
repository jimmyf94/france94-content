'use client';

import { useEffect, useRef } from 'react';

import { FilterForm, type ReviewFilters } from './FilterDrawer';

export function IconFilter({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

export function hasActiveReviewFilters(filters: ReviewFilters): boolean {
  return Boolean(
    filters.postType ||
      filters.date ||
      filters.priorityMin ||
      filters.priorityMax ||
      filters.search,
  );
}

export function FilterToggleButton({
  filters,
  onChangeFilters,
  open,
  onToggle,
  onClose,
  popoverAlign = 'left',
}: {
  filters: ReviewFilters;
  onChangeFilters: (f: ReviewFilters) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  popoverAlign?: 'left' | 'right';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  const highlighted = open || hasActiveReviewFilters(filters);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className={`cockpit-btn-secondary p-1.5 ${
          highlighted ? 'border-[var(--accent)] text-[var(--accent)]' : ''
        }`}
        aria-label="Filters"
        aria-expanded={open}
        title="Filters"
      >
        <IconFilter />
      </button>
      {open && (
        <div
          className={`absolute top-full z-50 mt-1 w-[min(90vw,36rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-xl ${
            popoverAlign === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <FilterForm filters={filters} onChange={onChangeFilters} />
        </div>
      )}
    </div>
  );
}
