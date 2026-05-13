'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { AssetDetailResponse, AssetUsageEventDto } from '@/lib/asset-library-types';

import { EligibilityBadge } from './EligibilityBadge';

type Tab = 'overview' | 'ai' | 'transcript' | 'usage' | 'related';

function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

export function AssetDetailDrawer({
  assetId,
  initialTab,
  open,
  onClose,
}: {
  assetId: string | null;
  initialTab?: Tab;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AssetDetailResponse | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/content-assets/${assetId}`, { credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof j.error === 'string' ? j.error : 'Failed to load');
        setData(null);
        return;
      }
      setData(j as AssetDetailResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    if (!open || !assetId) return;
    setTab(initialTab ?? 'overview');
    void load();
  }, [open, assetId, initialTab, load]);

  useEffect(() => {
    if (data?.asset) {
      setNotesDraft(str(data.asset.asset_notes));
    }
  }, [data]);

  async function saveNotes() {
    if (!assetId || !data) return;
    setSavingNotes(true);
    try {
      const el = (str(data.asset.candidate_eligibility) || 'eligible').trim();
      const res = await fetch(`/api/content-assets/${assetId}/eligibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          candidate_eligibility: el,
          asset_notes: notesDraft.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        window.alert(typeof j.error === 'string' ? j.error : 'Save failed');
        return;
      }
      void load();
    } finally {
      setSavingNotes(false);
    }
  }

  if (!open) return null;

  const asset = data?.asset ?? {};
  const previewUrl = assetId ? `/api/content-assets/${assetId}/preview` : '';
  const mime = str(asset.mime_type);
  const isVideo = mime.startsWith('video/');
  const isImage = mime.startsWith('image/');

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="presentation">
      <button
        type="button"
        className="h-full flex-1 cursor-default bg-transparent"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-[var(--text)]">
            {str(asset.final_filename || asset.current_filename || asset.original_filename) || 'Asset'}
          </h2>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="border-b border-[var(--border)] px-2 py-2">
          <nav className="flex flex-wrap gap-1 text-xs">
            {(
              [
                ['overview', 'Overview'],
                ['ai', 'AI summary'],
                ['transcript', 'Transcript'],
                ['usage', 'Usage history'],
                ['related', 'Related'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded px-2 py-1 ${
                  tab === k
                    ? 'bg-[var(--accent)] text-[var(--bg)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          {loading ? <p className="text-[var(--muted)]">Loading…</p> : null}
          {err ? <p className="text-rose-400">{err}</p> : null}
          {!loading && data ? (
            <>
              {tab === 'overview' ? (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--bg)]">
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="" className="max-h-64 w-full object-contain" />
                    ) : isVideo ? (
                      <video src={previewUrl} controls className="max-h-64 w-full" />
                    ) : (
                      <div className="p-4 text-[var(--muted)]">
                        Preview not available for this type.{' '}
                        {str(asset.drive_web_view_link) ? (
                          <a
                            href={str(asset.drive_web_view_link)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--accent)] underline"
                          >
                            Open in Drive
                          </a>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <EligibilityBadge value={str(asset.candidate_eligibility)} />
                    <span className="text-[var(--muted)]">{str(asset.media_type)}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-[var(--muted)]">Lane</dt>
                    <dd>{str(asset.content_lane) || '—'}</dd>
                    <dt className="text-[var(--muted)]">Activity</dt>
                    <dd>{str(asset.activity) || '—'}</dd>
                    <dt className="text-[var(--muted)]">Quality</dt>
                    <dd>{str(asset.quality_score) || '—'}</dd>
                    <dt className="text-[var(--muted)]">Usage / suggestions</dt>
                    <dd>
                      {str(asset.usage_count)} / {str(asset.suggestion_count)}
                    </dd>
                    <dt className="text-[var(--muted)]">Last used</dt>
                    <dd>{str(asset.last_used_at) || '—'}</dd>
                    <dt className="text-[var(--muted)]">Processed</dt>
                    <dd>{str(asset.processed_at) || '—'}</dd>
                    <dt className="text-[var(--muted)]">Drive</dt>
                    <dd>
                      {str(asset.drive_web_view_link) ? (
                        <a
                          href={str(asset.drive_web_view_link)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--accent)] underline"
                        >
                          Open
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </dl>
                  <label className="block text-xs text-[var(--muted)]">
                    Notes
                    <textarea
                      className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-[var(--text)]"
                      rows={3}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded border border-[var(--accent)] px-2 py-1 text-xs text-[var(--text)] disabled:opacity-50"
                    disabled={savingNotes || !data}
                    onClick={() => void saveNotes()}
                  >
                    {savingNotes ? 'Saving…' : 'Save notes'}
                  </button>
                </div>
              ) : null}

              {tab === 'ai' ? (
                <div className="space-y-3 text-xs">
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Visual summary</h3>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">
                      {str(asset.visual_summary) || '—'}
                    </p>
                  </section>
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Semantic summary</h3>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">
                      {str(asset.semantic_summary) || '—'}
                    </p>
                  </section>
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Tags</h3>
                    <p className="mt-1 text-[var(--muted)]">
                      {Array.isArray(asset.tags) && asset.tags.length
                        ? (asset.tags as string[]).join(', ')
                        : '—'}
                    </p>
                  </section>
                </div>
              ) : null}

              {tab === 'transcript' ? (
                <div className="space-y-3 text-xs">
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Transcript</h3>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[var(--muted)]">
                      {str(asset.transcript) || '—'}
                    </pre>
                  </section>
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Audio transcript</h3>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-[var(--muted)]">
                      {str(asset.audio_transcript) || '—'}
                    </pre>
                  </section>
                </div>
              ) : null}

              {tab === 'usage' ? (
                <ul className="space-y-2 text-xs">
                  {data.usage_events.length === 0 ? (
                    <li className="text-[var(--muted)]">No usage events.</li>
                  ) : (
                    data.usage_events.map((e: AssetUsageEventDto) => (
                      <li
                        key={e.id}
                        className="rounded border border-[var(--border)] bg-[var(--bg)] p-2"
                      >
                        <div className="font-medium text-[var(--text)]">
                          {e.event_kind || e.usage_stage} · {e.usage_type}
                        </div>
                        <div className="text-[var(--muted)]">{e.used_at || e.created_at}</div>
                        {e.notes ? <div className="mt-1 text-[var(--muted)]">{e.notes}</div> : null}
                      </li>
                    ))
                  )}
                </ul>
              ) : null}

              {tab === 'related' ? (
                <div className="space-y-4 text-xs">
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Post candidates</h3>
                    <ul className="mt-2 space-y-2">
                      {data.related_candidates.length === 0 ? (
                        <li className="text-[var(--muted)]">None linked.</li>
                      ) : (
                        data.related_candidates.map((c) => (
                          <li key={str(c.id)}>
                            <Link
                              href="/content/review"
                              className="text-[var(--accent)] underline"
                            >
                              {str(c.title)}
                            </Link>
                            <span className="text-[var(--muted)]"> · {str(c.status)}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <section>
                    <h3 className="font-medium text-[var(--text)]">Publishing jobs</h3>
                    <ul className="mt-2 space-y-2">
                      {data.publishing_jobs.length === 0 ? (
                        <li className="text-[var(--muted)]">None in ledger.</li>
                      ) : (
                        data.publishing_jobs.map((j) => (
                          <li key={str(j.id)}>
                            <Link
                              href={`/content/publishing/${encodeURIComponent(str(j.id))}`}
                              className="text-[var(--accent)] underline"
                            >
                              {str(j.id).slice(0, 8)}…
                            </Link>
                            <span className="text-[var(--muted)]">
                              {' '}
                              · {str(j.status)} · {str(j.publish_type)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
