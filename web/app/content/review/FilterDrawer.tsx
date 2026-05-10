'use client';

export type ReviewFilters = {
  postType: string;
  date: string;
  priorityMin: string;
  priorityMax: string;
  search: string;
};

export const EMPTY_FILTERS: ReviewFilters = {
  postType: '',
  date: '',
  priorityMin: '',
  priorityMax: '',
  search: '',
};

const POST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'reel', label: 'Reel' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'story_sequence', label: 'Story sequence' },
  { value: 'static_post', label: 'Static post' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
      {label}
      {children}
    </label>
  );
}

const inputCls =
  'rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)]';

export function FilterForm({
  filters,
  onChange,
}: {
  filters: ReviewFilters;
  onChange: (f: ReviewFilters) => void;
}) {
  const set = <K extends keyof ReviewFilters>(k: K, v: ReviewFilters[K]) =>
    onChange({ ...filters, [k]: v });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Post type">
          <select
            value={filters.postType}
            onChange={(e) => set('postType', e.target.value)}
            className={inputCls}
          >
            {POST_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={filters.date}
            onChange={(e) => set('date', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Priority ≥">
          <input
            value={filters.priorityMin}
            onChange={(e) => set('priorityMin', e.target.value)}
            inputMode="decimal"
            className={inputCls}
            placeholder="e.g. 7"
          />
        </Field>
        <Field label="Priority ≤">
          <input
            value={filters.priorityMax}
            onChange={(e) => set('priorityMax', e.target.value)}
            inputMode="decimal"
            className={inputCls}
            placeholder="e.g. 10"
          />
        </Field>
        <Field label="Search">
          <input
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="title, hook, captions"
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-xs text-[var(--muted)] underline"
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}

export function FilterDrawer({
  filters,
  onChange,
}: {
  filters: ReviewFilters;
  onChange: (f: ReviewFilters) => void;
}) {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 lg:px-6">
      <FilterForm filters={filters} onChange={onChange} />
    </div>
  );
}
