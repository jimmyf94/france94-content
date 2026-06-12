'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_REEL_RENDER_TEXT_STYLE,
  type ReelRenderTextStyle,
} from '@fr94/reel-text-style';

import { readJsonResponse } from '@/lib/read-json-response';

import { ReelTextStyleFields } from '../ReelTextStyleFields';

export function ReelTextDefaultsSection({
  onFeedback,
}: {
  onFeedback: (f: { kind: 'good' | 'bad'; msg: string }) => void;
}) {
  const [defaults, setDefaults] = useState<ReelRenderTextStyle>(DEFAULT_REEL_RENDER_TEXT_STYLE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content-review/reel-render-defaults', {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await readJsonResponse<{ defaults?: ReelRenderTextStyle; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.defaults) setDefaults(json.defaults);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/content-review/reel-render-defaults', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaults),
      });
      const json = await readJsonResponse<{ defaults?: ReelRenderTextStyle; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.defaults) setDefaults(json.defaults);
      onFeedback({ kind: 'good', msg: 'Reel text defaults saved' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onFeedback({ kind: 'bad', msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text)]">Reel text defaults</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Applied to new clip-based reels at generation time. Existing candidates keep their saved style
        unless you override them in the reel preview card.
      </p>
      {loading && <p className="mt-3 text-sm text-[var(--muted)]">Loading defaults…</p>}
      {error && <p className="mt-3 text-sm text-[var(--bad)]">{error}</p>}
      {!loading && (
        <div className="mt-4 space-y-4">
          <ReelTextStyleFields style={defaults} onChange={setDefaults} disabled={saving} />
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      )}
    </section>
  );
}
