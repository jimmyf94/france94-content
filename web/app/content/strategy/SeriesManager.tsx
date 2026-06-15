'use client';

import { useCallback, useEffect, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';
import { dispatchPipelineRun } from '@/lib/pipeline-run-client';

type SeriesExample = { hook?: string; notes?: string; url?: string };

type Series = {
  id: string;
  slug: string;
  name: string;
  weight: number;
  body_md: string;
  status: 'active' | 'archived';
  description: string;
  vision: string;
  tone: string;
  discovery_patterns: string[];
  examples: SeriesExample[];
  example_creators: string[];
  target_platforms: string[];
  enabled_post_types: string[];
  updated_at: string;
};

const POST_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'reel', label: 'Reels' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'static_post', label: 'Single image post' },
  { value: 'story_sequence', label: 'Story' },
  { value: 'long_form_video', label: 'Long form video' },
];

const DEFAULT_BODY = `## What it is

## Core angle

## Repeatable formats

## Hook examples

## Example episode ideas
`;

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function examplesToText(examples: SeriesExample[]): string {
  return examples
    .map((ex) => [ex.hook, ex.notes].filter((t) => t?.trim()).join(' — '))
    .filter(Boolean)
    .join('\n');
}

function textToExamples(text: string): SeriesExample[] {
  return linesToList(text).map((line) => {
    const sep = line.indexOf(' — ');
    if (sep > 0) {
      return { hook: line.slice(0, sep).trim(), notes: line.slice(sep + 3).trim() };
    }
    return { hook: line };
  });
}

export function SeriesManager() {
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<Series>>>({});

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-review/content-series', { credentials: 'include' });
      const json = await readJsonResponse<{ series?: Series[]; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setSeries(json.series ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = series.filter((s) => showArchived || s.status === 'active');

  const getDraft = (s: Series): Series => ({
    ...s,
    ...drafts[s.id],
  });

  const setDraft = (id: string, patch: Partial<Series>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const togglePostType = (s: Series, value: string) => {
    const draft = getDraft(s);
    const current = draft.enabled_post_types ?? [];
    const next = current.includes(value)
      ? current.filter((t) => t !== value)
      : [...current, value];
    setDraft(s.id, { enabled_post_types: next });
  };

  const saveSeries = async (id: string) => {
    const original = series.find((s) => s.id === id);
    if (!original) return;
    const draft = getDraft(original);
    setSavingId(id);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/content-review/content-series/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          weight: draft.weight,
          body_md: draft.body_md,
          status: draft.status,
          description: draft.description,
          vision: draft.vision,
          tone: draft.tone,
          discovery_patterns: draft.discovery_patterns,
          examples: draft.examples,
          example_creators: draft.example_creators,
          target_platforms: draft.target_platforms,
          enabled_post_types: draft.enabled_post_types,
        }),
      });
      const json = await readJsonResponse<{ series?: Series; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.series) {
        setSeries((prev) => prev.map((s) => (s.id === id ? json.series! : s)));
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setMessage('Series saved.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const createSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/content-review/content-series', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          body_md: DEFAULT_BODY,
          weight: 1,
        }),
      });
      const json = await readJsonResponse<{ series?: Series; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.series) {
        setSeries((prev) => [json.series!, ...prev]);
        setNewName('');
        setEditingId(json.series.id);
        setMessage('Series created.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const generateFromSeries = async (s: Series) => {
    if (drafts[s.id]) {
      setError('Save your edits before generating from this series.');
      return;
    }
    if (s.status !== 'active') {
      setError('Restore this series before generating from it.');
      return;
    }

    setGeneratingId(s.id);
    setMessage(null);
    setError(null);
    try {
      await dispatchPipelineRun('candidates_only', { seriesSlug: s.slug });
      setMessage(`Generation dispatched for "${s.name}". Check Review when the pipeline finishes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:p-6">
      <header>
        <h1 className="text-lg font-semibold">Content series</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Each series is a configurable content strategy: vision, tone, discovery patterns,
          examples, allowed post types and a generation weight. Higher weight = more likely to be
          picked in the global pipeline. Use Generate posts on a series to build candidates from
          that strategy only.
        </p>
      </header>

      {error ? (
        <p className="rounded-md border border-[var(--bad)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--bad)]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-[var(--good)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--good)]">
          {message}
        </p>
      ) : null}

      <form onSubmit={createSeries} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs text-[var(--muted)]">
          New series name
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Carto porn funny"
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Add series'}
        </button>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </form>

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading series…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No series yet.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((s) => {
            const draft = getDraft(s);
            const isEditing = editingId === s.id;
            const dirty = Boolean(drafts[s.id]);
            return (
              <li
                key={s.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{draft.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-[var(--muted)]">
                      {draft.slug}
                      {draft.status === 'archived' ? ' · archived' : ''}
                    </div>
                    {(draft.enabled_post_types?.length ?? 0) > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {draft.enabled_post_types.map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]"
                          >
                            {POST_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                        All post types
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                      Weight
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={draft.weight}
                        onChange={(e) =>
                          setDraft(s.id, { weight: Number.parseFloat(e.target.value) || 0 })
                        }
                        className="w-16 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditingId(isEditing ? null : s.id)}
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm hover:border-[var(--accent)]"
                    >
                      {isEditing ? 'Collapse' : 'Edit'}
                    </button>
                    {draft.status === 'active' ? (
                      <button
                        type="button"
                        disabled={generatingId === s.id || savingId === s.id || dirty}
                        onClick={() => void generateFromSeries(s)}
                        className="rounded-md border border-[var(--accent)] px-2.5 py-1 text-sm font-medium text-[var(--accent)] disabled:opacity-50"
                      >
                        {generatingId === s.id ? 'Generating…' : 'Generate posts'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={savingId === s.id || !dirty}
                      onClick={() => void saveSeries(s.id)}
                      className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingId === s.id ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(s.id, {
                          status: draft.status === 'active' ? 'archived' : 'active',
                        })
                      }
                      className="rounded-md border border-[var(--border)] px-2.5 py-1 text-sm text-[var(--muted)]"
                    >
                      {draft.status === 'active' ? 'Archive' : 'Restore'}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                        Name
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft(s.id, { name: e.target.value })}
                          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                        Tone
                        <input
                          value={draft.tone}
                          onChange={(e) => setDraft(s.id, { tone: e.target.value })}
                          placeholder="e.g. dry, absurd, never motivational"
                          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                      Description
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft(s.id, { description: e.target.value })}
                        rows={2}
                        placeholder="What this series is, in one or two sentences."
                        className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                      Vision
                      <textarea
                        value={draft.vision}
                        onChange={(e) => setDraft(s.id, { vision: e.target.value })}
                        rows={2}
                        placeholder="Why this series exists; what it should achieve."
                        className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                      />
                    </label>

                    <fieldset className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                      Enabled post types (empty = all)
                      <div className="mt-1 flex flex-wrap gap-3">
                        {POST_TYPE_OPTIONS.map((opt) => (
                          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={draft.enabled_post_types?.includes(opt.value) ?? false}
                              onChange={() => togglePostType(s, opt.value)}
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                        Discovery patterns (one per line)
                        <textarea
                          value={(draft.discovery_patterns ?? []).join('\n')}
                          onChange={(e) =>
                            setDraft(s.id, { discovery_patterns: linesToList(e.target.value) })
                          }
                          rows={4}
                          placeholder={'relatable-pain\nabsurd-scale'}
                          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-xs"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                        Example posts (one per line, optional “hook — notes”)
                        <textarea
                          value={examplesToText(draft.examples ?? [])}
                          onChange={(e) => setDraft(s.id, { examples: textToExamples(e.target.value) })}
                          rows={4}
                          placeholder={'pov : ta vie est devenue un plan d’entraînement'}
                          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-xs"
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                        Example creators (comma-separated)
                        <input
                          value={(draft.example_creators ?? []).join(', ')}
                          onChange={(e) =>
                            setDraft(s.id, {
                              example_creators: e.target.value
                                .split(',')
                                .map((v) => v.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="@creator1, @creator2"
                          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                        Target platforms (comma-separated)
                        <input
                          value={(draft.target_platforms ?? []).join(', ')}
                          onChange={(e) =>
                            setDraft(s.id, {
                              target_platforms: e.target.value
                                .split(',')
                                .map((v) => v.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="instagram"
                          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                        />
                      </label>
                    </div>

                    <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                      Brief (markdown, fed to generation)
                      <textarea
                        value={draft.body_md}
                        onChange={(e) => setDraft(s.id, { body_md: e.target.value })}
                        rows={14}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs leading-relaxed"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="mt-2 line-clamp-3 text-sm text-[var(--muted)]">
                    {(draft.description || draft.body_md).trim().slice(0, 280)}
                    {(draft.description || draft.body_md).length > 280 ? '…' : ''}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
