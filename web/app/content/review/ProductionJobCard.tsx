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
import { REEL_MAX_CLIPS } from '@fr94/reel-clip-limits';
import { parseRenderProgressLog } from '@fr94/reel-render-progress';

import { collectAttachedClipIds } from '@/lib/append-candidate-reel-clips';
import { readJsonResponse } from '@/lib/read-json-response';

import { ReelClipPickerModal } from './ReelClipPickerModal';
import { ReelProductionWorkspace } from './ReelProductionWorkspace';
import type { PostCandidate, ReelHookLabPersistedOption, ReelReasoning, ReelVariantKind, ReviewDriveFile } from './types';
import { isLockedReviewCandidate } from './types';
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

const POLL_ACTIVE_MS = 3000;
const POLL_AFTER_RENDER_MAX = 60;

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

/** Stable version for produced renders; avoids busting on unrelated job row updates. */
function producedRenderVersion(job: Pick<ProductionJobDto, 'status' | 'render_log' | 'updated_at'>): string | null {
  if (job.status !== 'produced') return null;
  const progress = parseRenderProgressLog(job.render_log);
  if (progress?.stage === 'done') return progress.updated_at;
  return job.updated_at;
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
  onReelClipsAdded,
  onReelReassembled,
}: {
  candidate: PostCandidate;
  onVariantCreated?: (c: PostCandidate) => void;
  onCandidateUpdated?: (c: PostCandidate) => void;
  layout?: 'compact' | 'workspace';
  media?: CandidateMediaState;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  onReelClipsAdded?: (c: PostCandidate) => void;
  onReelReassembled?: (c: PostCandidate) => void;
}) {
  const [job, setJob] = useState<ProductionJobDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variantBusy, setVariantBusy] = useState<ReelVariantKind | null>(null);
  const [hookLabPending, setHookLabPending] = useState<ReelHookLabPersistedOption[]>([]);
  const [hookLabAccepted, setHookLabAccepted] = useState<ReelHookLabPersistedOption[]>([]);
  const [hookLabSelected, setHookLabSelected] = useState<string[]>([]);
  const [hookLabNotes, setHookLabNotes] = useState('');
  const [hookLabBusy, setHookLabBusy] = useState<
    'load' | 'generate' | 'accept' | 'delete' | 'apply' | 'variants' | null
  >(null);
  const [hookLabBusyOptionId, setHookLabBusyOptionId] = useState<string | null>(null);
  const [hookLabError, setHookLabError] = useState<string | null>(null);
  const [renderMessage, setRenderMessage] = useState<string | null>(null);
  const [styleBusy, setStyleBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [workspaceDefaults, setWorkspaceDefaults] = useState<ReelRenderTextStyle>(
    DEFAULT_REEL_RENDER_TEXT_STYLE,
  );
  const [draftStyle, setDraftStyle] = useState<ReelRenderTextStyle>(DEFAULT_REEL_RENDER_TEXT_STYLE);
  const [draftOverlay, setDraftOverlay] = useState('');
  const [draftOverlayEndSec, setDraftOverlayEndSec] = useState<number | null>(null);
  const [draftTimedCues, setDraftTimedCues] = useState<ReelTimedOverlayCue[]>([]);
  const [clipPickerOpen, setClipPickerOpen] = useState(false);
  const [reassembleBusy, setReassembleBusy] = useState(false);

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
      if (document.hidden) continue;
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
      message?: string;
      dispatched?: boolean;
      job?: ProductionJobDto;
    }>(res);
    if (!res.ok) throw new Error(json.error || res.statusText);
    if (typeof json.message === 'string' && json.message.trim()) {
      setRenderMessage(json.message.trim());
    } else {
      setRenderMessage(null);
    }
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

  const loadHookLab = useCallback(async () => {
    if (!isClipReel) {
      setHookLabPending([]);
      setHookLabAccepted([]);
      return;
    }
    setHookLabBusy('load');
    setHookLabError(null);
    try {
      const res = await fetch(`/api/content-review/candidates/${candidate.id}/hook-lab`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await readJsonResponse<{
        pending?: ReelHookLabPersistedOption[];
        accepted?: ReelHookLabPersistedOption[];
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(json.error || res.statusText);
      setHookLabPending(json.pending ?? []);
      setHookLabAccepted(json.accepted ?? []);
    } catch (e) {
      setHookLabError(e instanceof Error ? e.message : String(e));
      setHookLabPending([]);
      setHookLabAccepted([]);
    } finally {
      setHookLabBusy((prev) => (prev === 'load' ? null : prev));
    }
  }, [candidate.id, isClipReel]);

  useEffect(() => {
    setHookLabSelected([]);
    setHookLabError(null);
    void loadHookLab();
  }, [candidate.id, loadHookLab]);

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
    const tick = () => {
      if (!document.hidden) void load();
    };
    const t = window.setInterval(tick, POLL_ACTIVE_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
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

  const attachedClipIds = useMemo(
    () =>
      collectAttachedClipIds(candidate.reel_instructions, candidate.selected_clip_ids),
    [candidate.reel_instructions, candidate.selected_clip_ids],
  );

  const canAddClips =
    isClipReel &&
    !isLockedReviewCandidate(candidate.status) &&
    attachedClipIds.length < REEL_MAX_CLIPS;

  const reassembleClips = useCallback(async () => {
    if (reassembleBusy || !isClipReel) return;
    setReassembleBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-review/candidates/${candidate.id}/reassemble-clips`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      const json = await readJsonResponse<{ candidate?: PostCandidate; error?: string }>(res);
      if (!res.ok || !json.candidate) {
        throw new Error(json.error || res.statusText);
      }
      onCandidateUpdated?.(json.candidate);
      onReelReassembled?.(json.candidate);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReassembleBusy(false);
    }
  }, [
    candidate.id,
    isClipReel,
    load,
    onCandidateUpdated,
    onReelReassembled,
    reassembleBusy,
  ]);

  const generateHookLab = useCallback(async () => {
    if (hookLabBusy) return;
    setHookLabBusy('generate');
    setHookLabError(null);
    try {
      const notes = hookLabNotes.trim();
      const res = await fetch(`/api/content-review/candidates/${candidate.id}/hook-lab`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          option_count: 9,
          reviewer_notes: notes || null,
        }),
      });
      const json = await readJsonResponse<{
        pending?: ReelHookLabPersistedOption[];
        accepted?: ReelHookLabPersistedOption[];
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(json.error || res.statusText);
      }
      setHookLabPending(json.pending ?? []);
      setHookLabAccepted(json.accepted ?? []);
      setHookLabSelected([]);
      if (notes) setHookLabNotes('');
    } catch (e) {
      setHookLabError(e instanceof Error ? e.message : String(e));
    } finally {
      setHookLabBusy(null);
    }
  }, [candidate.id, hookLabBusy, hookLabNotes]);

  const toggleHookLabSelection = useCallback((hook: string) => {
    setHookLabSelected((prev) =>
      prev.includes(hook) ? prev.filter((h) => h !== hook) : [...prev, hook],
    );
  }, []);

  const selectAllHookLab = useCallback(() => {
    setHookLabSelected(hookLabPending.map((o) => o.hook));
  }, [hookLabPending]);

  const acceptHookLabOption = useCallback(
    async (optionId: string) => {
      if (hookLabBusy) return;
      setHookLabBusy('accept');
      setHookLabBusyOptionId(optionId);
      setHookLabError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/hook-lab`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept', option_id: optionId }),
        });
        const json = await readJsonResponse<{
          pending?: ReelHookLabPersistedOption[];
          accepted?: ReelHookLabPersistedOption[];
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        setHookLabPending(json.pending ?? []);
        setHookLabAccepted(json.accepted ?? []);
        setHookLabSelected((prev) =>
          prev.filter((hook) => (json.pending ?? []).some((o) => o.hook === hook)),
        );
      } catch (e) {
        setHookLabError(e instanceof Error ? e.message : String(e));
      } finally {
        setHookLabBusy(null);
        setHookLabBusyOptionId(null);
      }
    },
    [candidate.id, hookLabBusy],
  );

  const deleteHookLabOption = useCallback(
    async (optionId: string) => {
      if (hookLabBusy) return;
      setHookLabBusy('delete');
      setHookLabBusyOptionId(optionId);
      setHookLabError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/hook-lab`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', option_id: optionId }),
        });
        const json = await readJsonResponse<{
          pending?: ReelHookLabPersistedOption[];
          accepted?: ReelHookLabPersistedOption[];
          error?: string;
        }>(res);
        if (!res.ok) throw new Error(json.error || res.statusText);
        setHookLabPending(json.pending ?? []);
        setHookLabAccepted(json.accepted ?? []);
        setHookLabSelected((prev) =>
          prev.filter((hook) => (json.pending ?? []).some((o) => o.hook === hook)),
        );
      } catch (e) {
        setHookLabError(e instanceof Error ? e.message : String(e));
      } finally {
        setHookLabBusy(null);
        setHookLabBusyOptionId(null);
      }
    },
    [candidate.id, hookLabBusy],
  );

  const clearHookLabSelection = useCallback(() => {
    setHookLabSelected([]);
  }, []);

  const applyHookLab = useCallback(
    async (hook: string, optionId?: string) => {
      if (hookLabBusy) return;
      setHookLabBusy('apply');
      if (optionId) setHookLabBusyOptionId(optionId);
      setHookLabError(null);
      try {
        const res = await fetch(`/api/content-review/candidates/${candidate.id}/hook-lab`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply', hook }),
        });
        const json = await readJsonResponse<{
          candidate?: PostCandidate;
          pending?: ReelHookLabPersistedOption[];
          accepted?: ReelHookLabPersistedOption[];
          error?: string;
        }>(res);
        if (!res.ok || !json.candidate) {
          throw new Error(json.error || res.statusText);
        }
        if (json.pending) setHookLabPending(json.pending);
        if (json.accepted) setHookLabAccepted(json.accepted);
        onCandidateUpdated?.(json.candidate);
        const ri = json.candidate.reel_instructions;
        const overlayLines =
          ri != null &&
          typeof ri === 'object' &&
          !Array.isArray(ri) &&
          Array.isArray((ri as Record<string, unknown>).overlay_lines)
            ? ((ri as Record<string, unknown>).overlay_lines as string[])
            : undefined;
        setDraftOverlay(
          formatReelOverlayText(overlayLines, {
            titleOverlay: json.candidate.title_overlay,
            hook: json.candidate.hook,
          }),
        );
      } catch (e) {
        setHookLabError(e instanceof Error ? e.message : String(e));
      } finally {
        setHookLabBusy(null);
        setHookLabBusyOptionId(null);
      }
    },
    [candidate.id, hookLabBusy, onCandidateUpdated],
  );

  const createHookLabVariants = useCallback(async () => {
    if (hookLabBusy || hookLabSelected.length === 0) return;
    setHookLabBusy('variants');
    setHookLabError(null);
    try {
      const res = await fetch(`/api/content-review/candidates/${candidate.id}/hook-lab`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_variants', hooks: hookLabSelected }),
      });
      const json = await readJsonResponse<{
        created?: Array<{ candidate?: PostCandidate; hook: string }>;
        pending?: ReelHookLabPersistedOption[];
        accepted?: ReelHookLabPersistedOption[];
        errors?: string[];
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(json.error || res.statusText);
      }
      if (json.pending) setHookLabPending(json.pending);
      if (json.accepted) setHookLabAccepted(json.accepted);
      for (const item of json.created ?? []) {
        if (item.candidate) onVariantCreated?.(item.candidate);
      }
      if (json.errors && json.errors.length > 0) {
        setHookLabError(json.errors.join('\n'));
      }
      setHookLabSelected([]);
    } catch (e) {
      setHookLabError(e instanceof Error ? e.message : String(e));
    } finally {
      setHookLabBusy(null);
    }
  }, [candidate.id, hookLabBusy, hookLabSelected, onVariantCreated]);

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

  const renderVersion = job ? producedRenderVersion(job) : null;

  const previewUrl =
    !isRenderActive && job?.status === 'produced' && job.output_video_url
      ? withCacheBust(job.output_video_url, renderVersion)
      : null;
  const downloadUrl = previewUrl
    ? `/api/content-review/production-jobs/by-candidate/${encodeURIComponent(candidate.id)}/download?filename=${encodeURIComponent(reelDownloadFilename(candidate))}`
    : null;
  const rawPoster =
    previewUrl && job?.status === 'produced' ? job.thumbnail_url ?? null : null;
  const posterUrl = rawPoster ? withCacheBust(rawPoster, renderVersion) : null;

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
      hookLabPending={hookLabPending}
      hookLabAccepted={hookLabAccepted}
      hookLabSelected={hookLabSelected}
      hookLabNotes={hookLabNotes}
      hookLabBusy={hookLabBusy}
      hookLabBusyOptionId={hookLabBusyOptionId}
      hookLabError={hookLabError}
      renderMessage={renderMessage}
      onHookLabNotesChange={setHookLabNotes}
      onGenerateHookLab={() => void generateHookLab()}
      onToggleHookLabSelection={toggleHookLabSelection}
      onSelectAllHookLab={selectAllHookLab}
      onClearHookLabSelection={clearHookLabSelection}
      onAcceptHookLabOption={(optionId) => void acceptHookLabOption(optionId)}
      onDeleteHookLabOption={(optionId) => void deleteHookLabOption(optionId)}
      onApplyHookLab={(hook, optionId) => void applyHookLab(hook, optionId)}
      onCreateHookLabVariants={() => void createHookLabVariants()}
      media={media}
      videoRef={videoRef}
      onRegisterActivateStream={onRegisterActivateStream}
      onRemoveReviewAsset={onRemoveReviewAsset}
      draftDiffersFromRendered={draftDiffersFromRendered}
      maxClipPoolSize={REEL_MAX_CLIPS}
      canAddClips={canAddClips}
      reassembleBusy={reassembleBusy}
      onOpenClipPicker={() => setClipPickerOpen(true)}
      onReassembleClips={() => void reassembleClips()}
    />
    {canAddClips && (
      <ReelClipPickerModal
        open={clipPickerOpen}
        candidateId={candidate.id}
        attachedClipIds={attachedClipIds}
        clipCount={attachedClipIds.length}
        maxClips={REEL_MAX_CLIPS}
        onClose={() => setClipPickerOpen(false)}
        onAdded={(updated) => {
          onCandidateUpdated?.(updated);
          onReelClipsAdded?.(updated);
          setClipPickerOpen(false);
        }}
      />
    )}
    </div>
  );
}
