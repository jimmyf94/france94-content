'use client';

import { useEffect, useMemo, useState } from 'react';

import { readJsonResponse } from '@/lib/read-json-response';
import { buildCarouselPublishOrderRows } from '@/lib/carousel-publish-order-display';

import type { PostCandidate, ReviewDriveFile } from '../types';

type StructureRow = { time: string; instruction: string };

function SectionWrap({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 text-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function parseReelData(data: Record<string, unknown>): {
  dur: number | null;
  structure: StructureRow[];
  overlays: string[];
  thumb: string | null;
} {
  const dur =
    typeof data.estimated_duration_seconds === 'number' ? data.estimated_duration_seconds : null;
  const structureRaw = Array.isArray(data.structure) ? data.structure : [];
  const structure: StructureRow[] = structureRaw.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      time: typeof r.time === 'string' ? r.time : '',
      instruction: typeof r.instruction === 'string' ? r.instruction : '',
    };
  });
  const overlaysRaw = Array.isArray(data.overlay_text) ? data.overlay_text : [];
  const overlays = overlaysRaw.map((o) => String(o));
  const thumb = typeof data.thumbnail_text === 'string' ? data.thumbnail_text : null;
  return { dur, structure, overlays, thumb };
}

function EditableReelTimeline({
  candidate,
  onCandidateUpdated,
}: {
  candidate: PostCandidate;
  onCandidateUpdated?: (c: PostCandidate) => void;
}) {
  const base = (
    candidate.reel_instructions != null && typeof candidate.reel_instructions === 'object'
      ? candidate.reel_instructions
      : {}
  ) as Record<string, unknown>;
  const parsed = useMemo(() => parseReelData(base), [candidate.reel_instructions]);

  const [structure, setStructure] = useState<StructureRow[]>(parsed.structure);
  const [overlays, setOverlays] = useState<string[]>(
    parsed.overlays.length > 0 ? parsed.overlays : [''],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = parseReelData((candidate.reel_instructions ?? {}) as Record<string, unknown>);
    setStructure(p.structure.length > 0 ? p.structure : [{ time: '', instruction: '' }]);
    setOverlays(p.overlays.length > 0 ? p.overlays : ['']);
    setError(null);
  }, [candidate.id, candidate.reel_instructions]);

  const normalizedOverlays = overlays.map((o) => o.trim()).filter(Boolean);
  const normalizedStructure = structure.map((r) => ({
    time: r.time.trim(),
    instruction: r.instruction.trim(),
  }));

  const savedStructureClean = parsed.structure.filter(
    (r) => r.time.trim() || r.instruction.trim(),
  );
  const draftStructureClean = normalizedStructure.filter((r) => r.time || r.instruction);

  const dirty =
    JSON.stringify(savedStructureClean) !== JSON.stringify(draftStructureClean) ||
    JSON.stringify(parsed.overlays) !== JSON.stringify(normalizedOverlays);

  const save = async () => {
    if (!onCandidateUpdated) return;
    const structurePayload = normalizedStructure.some((r) => r.time || r.instruction)
      ? normalizedStructure
      : [];
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-review/candidates/${candidate.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reel_instructions: {
            structure: structurePayload,
            overlay_text: normalizedOverlays,
          },
        }),
      });
      const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      if (json.candidate) onCandidateUpdated(json.candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const dur = parsed.dur;
  const thumb = parsed.thumb;

  return (
    <SectionWrap title="Reel timeline">
      <div className="space-y-4">
        {error && <p className="text-[var(--bad)]">{error}</p>}
        {dur != null && (
          <p>
            <span className="text-[var(--muted)]">Duration:</span> {dur}s
          </p>
        )}
        {thumb && (
          <p>
            <span className="text-[var(--muted)]">Thumbnail text:</span> {thumb}
          </p>
        )}

        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Structure
          </p>
          <ol className="space-y-2">
            {structure.map((row, i) => (
              <li
                key={i}
                className="flex flex-col gap-2 rounded border border-[var(--border)] p-2 sm:flex-row sm:items-start"
              >
                <input
                  type="text"
                  value={row.time}
                  onChange={(e) =>
                    setStructure((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, time: e.target.value } : r)),
                    )
                  }
                  placeholder="0:00"
                  className="w-full shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs tabular-nums sm:w-24"
                />
                <textarea
                  value={row.instruction}
                  onChange={(e) =>
                    setStructure((prev) =>
                      prev.map((r, j) =>
                        j === i ? { ...r, instruction: e.target.value } : r,
                      ),
                    )
                  }
                  placeholder="Beat / instruction…"
                  className="min-h-[48px] flex-1 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() =>
                    setStructure((prev) => prev.filter((_, j) => j !== i))
                  }
                  disabled={structure.length <= 1}
                  className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() =>
              setStructure((prev) => [...prev, { time: '', instruction: '' }])
            }
            className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--accent)]"
          >
            Add beat
          </button>
        </div>

        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Overlays
          </p>
          <ul className="space-y-2">
            {overlays.map((line, i) => (
              <li key={i} className="flex gap-2">
                <textarea
                  value={line}
                  onChange={(e) =>
                    setOverlays((prev) =>
                      prev.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                  placeholder="On-screen text…"
                  className="min-h-[40px] flex-1 resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setOverlays((prev) => prev.filter((_, j) => j !== i))}
                  disabled={overlays.length <= 1}
                  className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOverlays((prev) => [...prev, ''])}
            className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--accent)]"
          >
            Add overlay line
          </button>
        </div>

        {onCandidateUpdated && (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
            {dirty && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--warn)]">
                Unsaved
              </span>
            )}
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save structure & overlays'}
            </button>
          </div>
        )}
      </div>
    </SectionWrap>
  );
}

function StoryFrames({ frames }: { frames: unknown[] }) {
  return (
    <ul className="space-y-2">
      {frames.map((raw, i) => {
        const f = (raw ?? {}) as Record<string, unknown>;
        const overlay = typeof f.overlay_text === 'string' ? f.overlay_text : '';
        const interaction = typeof f.interaction === 'string' ? f.interaction : '';
        const hasAsset = f.asset_id != null;
        return (
          <li key={i} className="rounded border border-[var(--border)] p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              Frame {i + 1}
              {hasAsset && (
                <span className="ml-2 font-normal text-[var(--muted)]">· Asset #{i + 1}</span>
              )}
            </div>
            {overlay && <p className="mt-1">{overlay}</p>}
            {interaction && (
              <p className="mt-1 text-xs text-[var(--muted)]">Interaction: {interaction}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CarouselView({
  candidate,
  mediaFiles,
}: {
  candidate: PostCandidate;
  mediaFiles?: ReviewDriveFile[];
}) {
  const rows = buildCarouselPublishOrderRows({
    source_asset_ids: candidate.source_asset_ids,
    carousel_slides: candidate.carousel_slides,
    mediaFiles,
  });

  const notes = rows.filter((r) => r.headline || r.body);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--muted)]">
        Order matters. Caption is one per carousel. Slide notes are not posted to Instagram.
      </p>
      <ol className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.assetId}
            className="flex items-start gap-2 rounded border border-[var(--border)] px-2 py-1.5 text-xs"
          >
            <span className="shrink-0 pt-0.5 font-semibold tabular-nums text-[var(--accent)]">
              {row.slide}
            </span>
            <span className="min-w-0 break-all text-[var(--text)]">{row.label}</span>
          </li>
        ))}
      </ol>
      {notes.length > 0 && (
        <details className="rounded border border-[var(--border)] p-2">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Internal notes ({notes.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {notes.map((row) => (
              <li key={row.assetId} className="rounded border border-[var(--border)] p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                  Slide {row.slide} · {row.label}
                </p>
                {row.headline && <p className="mt-1 font-medium">{row.headline}</p>}
                {row.body && <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{row.body}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StaticView({ data }: { data: Record<string, unknown> }) {
  const layout = typeof data.layout === 'string' ? data.layout : '';
  const main = typeof data.main_text === 'string' ? data.main_text : '';
  const secondary = typeof data.secondary_text === 'string' ? data.secondary_text : '';
  const cta = typeof data.cta === 'string' ? data.cta : '';
  return (
    <div className="space-y-2">
      {layout && (
        <p>
          <span className="text-[var(--muted)]">Layout:</span> {layout}
        </p>
      )}
      {main && (
        <div>
          <p className="text-[var(--muted)]">Main</p>
          <p className="whitespace-pre-wrap">{main}</p>
        </div>
      )}
      {secondary && (
        <div>
          <p className="text-[var(--muted)]">Secondary</p>
          <p className="whitespace-pre-wrap">{secondary}</p>
        </div>
      )}
      {cta && (
        <p>
          <span className="text-[var(--muted)]">CTA:</span> {cta}
        </p>
      )}
    </div>
  );
}

function ClipsV1ReelSummary({ candidate }: { candidate: PostCandidate }) {
  const raw =
    candidate.reel_instructions != null && typeof candidate.reel_instructions === 'object'
      ? (candidate.reel_instructions as Record<string, unknown>)
      : null;
  const version = typeof raw?.version === 'string' ? raw.version : null;
  const clips = Array.isArray(raw?.clips) ? raw.clips : [];
  const overlayLines = Array.isArray(raw?.overlay_lines)
    ? raw.overlay_lines.map((l) => String(l))
    : [];
  const totalDuration =
    typeof raw?.total_duration_sec === 'number' ? raw.total_duration_sec : null;

  if (version !== 'clips-v1') return null;

  return (
    <SectionWrap title="Clip reel spec">
      <div className="space-y-3 text-sm">
        <p className="text-[var(--muted)]">
          This reel uses the clip assembly pipeline. Edit overlay text and styling in the production
          panel — not here.
        </p>
        {totalDuration != null && (
          <p>
            <span className="text-[var(--muted)]">Duration:</span> {totalDuration.toFixed(1)}s
          </p>
        )}
        {overlayLines.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Overlay lines
            </p>
            <ul className="space-y-1">
              {overlayLines.map((line, i) => (
                <li key={i} className="rounded border border-[var(--border)] p-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        {clips.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Clips ({clips.length})
            </p>
            <ol className="space-y-2">
              {clips.map((clipRaw, i) => {
                const c = (clipRaw ?? {}) as Record<string, unknown>;
                const start = typeof c.start_sec === 'number' ? c.start_sec : 0;
                const end = typeof c.end_sec === 'number' ? c.end_sec : 0;
                const why = typeof c.why === 'string' ? c.why : '';
                return (
                  <li key={i} className="rounded border border-[var(--border)] p-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      #{i + 1}
                    </span>{' '}
                    {(end - start).toFixed(1)}s
                    {why ? <p className="mt-1 text-[var(--muted)]">{why}</p> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </SectionWrap>
  );
}

export function StructureTab({
  candidate,
  mediaFiles,
  onCandidateUpdated,
}: {
  candidate: PostCandidate;
  mediaFiles?: ReviewDriveFile[];
  onCandidateUpdated?: (c: PostCandidate) => void;
}) {
  const t = candidate.post_type;
  if (t === 'reel') {
    const raw =
      candidate.reel_instructions != null && typeof candidate.reel_instructions === 'object'
        ? (candidate.reel_instructions as Record<string, unknown>)
        : null;
    if (raw?.version === 'clips-v1') {
      return <ClipsV1ReelSummary candidate={candidate} />;
    }
    return (
      <EditableReelTimeline candidate={candidate} onCandidateUpdated={onCandidateUpdated} />
    );
  }
  if (t === 'story_sequence' && Array.isArray(candidate.story_frames)) {
    return (
      <SectionWrap title="Story frames">
        <StoryFrames frames={candidate.story_frames} />
      </SectionWrap>
    );
  }
  if (t === 'carousel' && Array.isArray(candidate.carousel_slides)) {
    return (
      <SectionWrap title="Carousel publish order">
        <CarouselView candidate={candidate} mediaFiles={mediaFiles} />
      </SectionWrap>
    );
  }
  if (
    t === 'static_post' &&
    candidate.static_post_instructions &&
    typeof candidate.static_post_instructions === 'object'
  ) {
    return (
      <SectionWrap title="Static post">
        <StaticView data={candidate.static_post_instructions as Record<string, unknown>} />
      </SectionWrap>
    );
  }
  return <p className="text-sm text-[var(--muted)]">No structure for this post type.</p>;
}
