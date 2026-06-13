'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_REEL_RENDER_TEXT_STYLE,
  formatReelOverlayText,
  normalizeOverlayEndSec,
  normalizeTimedOverlayCues,
  parseOverlayEndSec,
  parseReelOverlayDraft,
  parseTimedOverlayCues,
  reelOverlayDraftDiffersFromRenderedSpec,
  resolveReelTextStyle,
  type ReelRenderTextStyle,
  type ReelTimedOverlayCue,
} from '@fr94/reel-text-style';

import { readJsonResponse } from '@/lib/read-json-response';

import { ReelProductionWorkspace } from './ReelProductionWorkspace';
import type { PostCandidate, ReelReasoning, ReelVariantKind, ReviewDriveFile } from './types';
import type { CandidateMediaState } from './useCandidateMedia';

type ProductionJobDto = {
  id: string;
  status: string;
  production_type: string;
  output_video_url: string | null;
  thumbnail_url: string | null;
  error_message: string | null;
  render_strategy: string | null;
  render_log: Record<string, unknown> | null;
  reel_specification: ReelSpecDto | null;
  updated_at: string | null;
};

type ReelSpecDto = {
  version?: string;
  clips?: Array<{
    clip_id: string;
    asset_id?: string;
    start_sec: number;
    end_sec: number;
    why?: string;
  }>;
  overlay_lines?: string[];
  overlay_end_sec?: number | null;
  timed_overlay_cues?: ReelTimedOverlayCue[];
  text_style?: Partial<ReelRenderTextStyle>;
  total_duration_sec?: number;
};

const POLL_ACTIVE_MS = 1500;
const POLL_AFTER_RENDER_MAX = 120;

function withCacheBust(url: string, version?: string | null): string {
  if (!version?.trim()) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('v', version);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}v=${encodeURIComponent(version)}`;
  }
}

function parseReelSpec(raw: unknown): ReelSpecDto | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as ReelSpecDto;
}

function parseReasoning(raw: unknown): ReelReasoning | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as ReelReasoning;
}

function renderButtonLabel(status: string | undefined): string {
  if (status === 'rendering') return 'Rendering…';
  if (status === 'failed' || status === 'needs_manual_production') return 'Retry render';
  if (status === 'produced') return 'Re-render';
  return 'Render now';
}

function reelDownloadFilename(candidate: PostCandidate): string {
  const date = candidate.candidate_date ?? 'undated';
  const core = (candidate.title ?? candidate.hook ?? candidate.id)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${date}_${core}_reel.mp4`;
}

export function ProductionJobCard({
  candidate,
  onVariantCreated,
  onCandidateUpdated,
  layout = 'compact',
  media,
  videoRef,
  onRegisterActivateStream,
  onRemoveReviewAsset,
}: {
  candidate: PostCandidate;
  onVariantCreated?: (c: PostCandidate) => void;
  onCandidateUpdated?: (c: PostCandidate) => void;
  layout?: 'compact' | 'workspace';
  media?: CandidateMediaState;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
}) {
  const [job, setJob] = useState<ProductionJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantBusy, setVariantBusy] = useState<ReelVariantKind | null>(null);
  const [styleBusy, setStyleBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [workspaceDefaults, setWorkspaceDefaults] = useState<ReelRenderTextStyle>(
    DEFAULT_REEL_RENDER_TEXT_STYLE,
  );
  const [draftStyle, setDraftStyle] = useState<ReelRenderTextStyle>(DEFAULT_REEL_RENDER_TEXT_STYLE);
  const [draftOverlay, setDraftOverlay] = useState('');
  const [draftOverlayEndSec, setDraftOverlayEndSec] = useState<number | null>(null);
  const [draftTimedCues, setDraftTimedCues] = useState<ReelTimedOverlayCue[]>([]);

  const reelSpec = useMemo(
    () => parseReelSpec(candidate.reel_instructions) ?? parseReelSpec(job?.reel_specification),
    [candidate.reel_instructions, job?.reel_specification],
  );

  const reasoning = useMemo(() => parseReasoning(candidate.reel_reasoning), [candidate.reel_reasoning]);

  const isClipReel = reelSpec?.version === 'clips-v1' && (reelSpec.clips?.length ?? 0) > 0;

  const overlayFallbacks = useMemo(
    () => ({
      titleOverlay: candidate.title_overlay,
      hook: candidate.hook,
    }),
    [candidate.hook, candidate.title_overlay],
  );

  const hookText = useMemo(() => {
    const text = formatReelOverlayText(reelSpec?.overlay_lines, overlayFallbacks);
    return text || null;
  }, [overlayFallbacks, reelSpec?.overlay_lines]);

  const durationSec = useMemo(() => {
    if (reelSpec?.total_duration_sec != null) return reelSpec.total_duration_sec;
    const logDur = Number(job?.render_log?.duration_seconds);
    if (Number.isFinite(logDur)) return logDur;
    return null;
  }, [reelSpec, job?.render_log]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/production-jobs/by-candidate/${encodeURIComponent(candidate.id)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (res.status === 404) {
        setJob(null);
        return null;
      }
      const json = await readJsonResponse<{ job?: ProductionJobDto; error?: string }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      const next = json.job ?? null;
      setJob(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setJob(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [candidate.id]);

  const refreshCandidate = useCallback(async () => {
    if (!onCandidateUpdated) return;
    try {
      const res = await fetch(`/api/content-review/candidates/${encodeURIComponent(candidate.id)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
      if (res.ok && json.candidate) onCandidateUpdated(json.candidate);
    } catch {
      /* best-effort */
    }
  }, [candidate.id, onCandidateUpdated]);

  const pollUntilRenderSettled = useCallback(async () => {
    for (let i = 0; i < POLL_AFTER_RENDER_MAX; i += 1) {
      await new Promise((r) => setTimeout(r, POLL_ACTIVE_MS));
      const res = await fetch(
        `/api/content-review/production-jobs/by-candidate/${encodeURIComponent(candidate.id)}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (res.status === 404) continue;
      const json = await readJsonResponse<{ job?: ProductionJobDto; error?: string }>(res);
      if (!res.ok || !json.job) continue;
      setJob(json.job);
      const st = json.job.status;
      if (st === 'produced' || st === 'failed' || st === 'needs_manual_production') {
        if (st === 'produced') void refreshCandidate();
        return;
      }
    }
  }, [candidate.id, refreshCandidate]);

  const triggerRender = useCallback(async () => {
    const res = await fetch(
      `/api/content-review/candidates/${encodeURIComponent(candidate.id)}/render-reel`,
      { method: 'POST', credentials: 'include' },
    );
    const json = await readJsonResponse<{
      ok?: boolean;
      error?: string;
      job?: ProductionJobDto;
    }>(res);
    if (!res.ok) throw new Error(json.error || res.statusText);
    if (json.job) {
      setJob(json.job);
    } else {
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: 'queued',
              output_video_url: null,
              thumbnail_url: null,
              error_message: null,
            }
          : prev,
      );
    }
    void refreshCandidate();
    void pollUntilRenderSettled();
  }, [candidate.id, pollUntilRenderSettled, refreshCandidate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/content-review/reel-render-defaults', {
          credentials: 'include',
          cache: 'no-store',
        });
        const json = await readJsonResponse<{ defaults?: ReelRenderTextStyle }>(res);
        if (res.ok && json.defaults) setWorkspaceDefaults(json.defaults);
      } catch {
        /* use code defaults */
      }
    })();
  }, []);

  useEffect(() => {
    if (!isClipReel) return;
    const specStyle = reelSpec?.text_style ?? null;
    setDraftStyle(resolveReelTextStyle(specStyle, workspaceDefaults));
    setDraftOverlay(formatReelOverlayText(reelSpec?.overlay_lines, overlayFallbacks));
    setDraftOverlayEndSec(parseOverlayEndSec(reelSpec?.overlay_end_sec));
    setDraftTimedCues(parseTimedOverlayCues(reelSpec?.timed_overlay_cues));
  }, [
    candidate.id,
    isClipReel,
    overlayFallbacks,
    reelSpec?.overlay_end_sec,
    reelSpec?.overlay_lines,
    reelSpec?.timed_overlay_cues,
    reelSpec?.text_style,
    workspaceDefaults,
  ]);

  useEffect(() => {
    const status = job?.status ?? '';
    if (status !== 'queued' && status !== 'rendering') return;
    const t = window.setInterval(() => void load(), POLL_ACTIVE_MS);
    return () => window.clearInterval(t);
  }, [job?.status, load]);

  const createVariant = useCallback(
    async (kind: ReelVariantKind) => {
      if (variantBusy) return;
      setVariantBusy(kind);
      setError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/variant`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind }),
        });
        const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
        if (!res.ok || !json.candidate) {
          throw new Error(json.error || res.statusText);
        }
        onVariantCreated?.(json.candidate);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setVariantBusy(null);
      }
    },
    [candidate.id, onVariantCreated, variantBusy],
  );

  const saveStyle = useCallback(
    async (reRender: boolean) => {
      if (styleBusy) return;
      setStyleBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reel_instructions: {
              overlay_lines: parseReelOverlayDraft(draftOverlay),
              overlay_end_sec: normalizeOverlayEndSec(draftOverlayEndSec, durationSec ?? 120),
              timed_overlay_cues: normalizeTimedOverlayCues(draftTimedCues, {
                maxDurationSec: durationSec ?? 120,
              }),
              text_style: draftStyle,
            },
            ...(reRender ? { re_render: true } : {}),
          }),
        });
        const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
        if (!res.ok || !json.candidate) {
          throw new Error(json.error || res.statusText);
        }
        onCandidateUpdated?.(json.candidate);
        if (reRender) {
          await triggerRender();
        } else {
          void load();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStyleBusy(false);
      }
    },
    [candidate.id, draftOverlay, draftOverlayEndSec, draftTimedCues, draftStyle, durationSec, load, onCandidateUpdated, styleBusy, triggerRender],
  );

  const startRenderNow = useCallback(async () => {
    if (renderBusy || job?.status === 'rendering' || styleBusy) return;
    if (isClipReel) {
      setRenderBusy(true);
      try {
        await saveStyle(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRenderBusy(false);
      }
      return;
    }
    setRenderBusy(true);
    setError(null);
    try {
      await triggerRender();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenderBusy(false);
    }
  }, [
    isClipReel,
    job?.status,
    renderBusy,
    saveStyle,
    styleBusy,
    triggerRender,
  ]);

  if (candidate.post_type !== 'reel') return null;

  const isRenderActive = job?.status === 'queued' || job?.status === 'rendering';

  const previewUrl =
    !isRenderActive && job?.status === 'produced' && job.output_video_url
      ? withCacheBust(job.output_video_url, job.updated_at)
      : null;
  const downloadUrl = previewUrl
    ? `/api/content-review/production-jobs/by-candidate/${encodeURIComponent(candidate.id)}/download?filename=${encodeURIComponent(reelDownloadFilename(candidate))}`
    : null;
  const rawPoster =
    previewUrl && job?.status === 'produced' ? job.thumbnail_url ?? null : null;
  const posterUrl = rawPoster ? withCacheBust(rawPoster, job?.updated_at) : null;

  const reasoningEntries: Array<[string, string]> = [
    ['Why the script works', reasoning?.why_script_works],
    ['Why clips support it', reasoning?.why_clips_support_script],
    ['Emotional contrast', reasoning?.emotional_contrast],
    ['Scroll-stop', reasoning?.scroll_stop],
    ['Series fit', reasoning?.series_fit],
    ['Vs alternatives', reasoning?.clips_vs_alternatives],
  ].filter(([, v]) => typeof v === 'string' && v.trim().length > 0) as Array<[string, string]>;

  const renderDisabled = renderBusy || styleBusy || job?.status === 'rendering';
  const renderLabel =
    styleBusy ? 'Saving…' : renderBusy ? 'Starting…' : renderButtonLabel(job?.status);

  const renderedSpec = useMemo(
    () => parseReelSpec(job?.reel_specification),
    [job?.reel_specification],
  );

  const draftDiffersFromRendered = useMemo(() => {
    if (!isClipReel || job?.status !== 'produced') return false;
    return reelOverlayDraftDiffersFromRenderedSpec({
      draftOverlay,
      draftOverlayEndSec,
      draftTimedCues,
      draftStyle,
      renderedSpec,
      workspaceDefaults,
      maxDurationSec: durationSec ?? 120,
    });
  }, [
    draftOverlay,
    draftOverlayEndSec,
    draftStyle,
    draftTimedCues,
    durationSec,
    isClipReel,
    job?.status,
    renderedSpec,
    workspaceDefaults,
  ]);

  return (
    <div className={layout === 'workspace' ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      <ReelProductionWorkspace
      candidate={candidate}
      layout={layout}
      hookText={hookText}
      durationSec={durationSec}
      clipCount={reelSpec?.clips?.length ?? 0}
      taggedClipCount={candidate.selected_clip_ids?.length ?? 0}
      loading={loading}
      error={error}
      job={
        job
          ? {
              status: job.status,
              render_strategy: job.render_strategy,
              error_message: job.error_message,
              render_log: job.render_log,
              updated_at: job.updated_at,
            }
          : null
      }
      isRenderActive={isRenderActive}
      previewUrl={previewUrl}
      downloadUrl={downloadUrl}
      posterUrl={posterUrl}
      renderDisabled={renderDisabled}
      renderLabel={renderLabel}
      renderIsReRender={
        job?.status === 'produced' ||
        job?.status === 'failed' ||
        job?.status === 'needs_manual_production'
      }
      onRender={() => void startRenderNow()}
      clips={reelSpec?.clips}
      reasoningEntries={reasoningEntries}
      isClipReel={isClipReel}
      draftOverlay={draftOverlay}
      draftOverlayEndSec={draftOverlayEndSec}
      draftTimedCues={draftTimedCues}
      draftStyle={draftStyle}
      overlayFallbacks={overlayFallbacks}
      styleBusy={styleBusy}
      variantBusy={variantBusy}
      onOverlayChange={setDraftOverlay}
      onOverlayEndSecChange={setDraftOverlayEndSec}
      onTimedCuesChange={setDraftTimedCues}
      onStyleChange={setDraftStyle}
      onCreateVariant={(kind) => void createVariant(kind)}
      media={media}
      videoRef={videoRef}
      onRegisterActivateStream={onRegisterActivateStream}
      onRemoveReviewAsset={onRemoveReviewAsset}
      draftDiffersFromRendered={draftDiffersFromRendered}
    />
    </div>
  );
}
