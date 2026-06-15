'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  parseReelOverlayDraft,
  REEL_TIMED_OVERLAY_MAX_CUES,
  resolveOverlayPreviewText,
  timedCueOverlapsOverlayEnd,
  type ReelRenderTextStyle,
  type ReelTimedOverlayCue,
} from '@fr94/reel-text-style';

import { MainMediaPreview } from './MainMediaPreview';
import { CollapsibleColumnFrame, ColumnPanelToggle, columnGridWidth } from './CollapsibleColumnFrame';
import { ReelRenderProgress } from './ReelRenderProgress';
import { ReelTextStyleFields } from './ReelTextStyleFields';
import { ReviewMediaTrashButton } from './ReviewMediaTrashButton';
import type { PostCandidate, ReelHookLabPersistedOption, ReelVariantKind, ReviewDriveFile } from './types';
import { REEL_VARIANT_KINDS, REEL_VARIANT_LABELS } from './types';
import type { CandidateMediaState } from './useCandidateMedia';

type ReelClip = {
  clip_id: string;
  asset_id?: string;
  start_sec: number;
  end_sec: number;
  why?: string;
};

type StageTab = 'rendered' | 'source';

export type ReelProductionWorkspaceProps = {
  candidate: PostCandidate;
  layout: 'compact' | 'workspace';
  hookText: string | null;
  durationSec: number | null;
  clipCount: number;
  taggedClipCount: number;
  loading: boolean;
  error: string | null;
  job: {
    status: string;
    render_strategy: string | null;
    error_message: string | null;
    render_log: Record<string, unknown> | null;
    updated_at: string | null;
  } | null;
  isRenderActive: boolean;
  previewUrl: string | null;
  downloadUrl: string | null;
  posterUrl: string | null;
  renderDisabled: boolean;
  renderLabel: string;
  renderIsReRender?: boolean;
  onRender: () => void;
  clips: ReelClip[] | undefined;
  reasoningEntries: Array<[string, string]>;
  isClipReel: boolean;
  draftOverlay: string;
  draftOverlayEndSec: number | null;
  draftTimedCues: ReelTimedOverlayCue[];
  draftStyle: ReelRenderTextStyle;
  overlayFallbacks?: { titleOverlay?: string | null; hook?: string | null };
  styleBusy: boolean;
  variantBusy: ReelVariantKind | null;
  onOverlayChange: (v: string) => void;
  onOverlayEndSecChange: (sec: number | null) => void;
  onTimedCuesChange: (cues: ReelTimedOverlayCue[]) => void;
  onStyleChange: (s: ReelRenderTextStyle) => void;
  onCreateVariant: (kind: ReelVariantKind) => void;
  hookLabPending: ReelHookLabPersistedOption[];
  hookLabAccepted: ReelHookLabPersistedOption[];
  hookLabSelected: string[];
  hookLabNotes: string;
  hookLabBusy: 'load' | 'generate' | 'accept' | 'delete' | 'apply' | 'variants' | null;
  hookLabBusyOptionId?: string | null;
  hookLabError: string | null;
  renderMessage?: string | null;
  onHookLabNotesChange: (notes: string) => void;
  onGenerateHookLab: () => void;
  onToggleHookLabSelection: (hook: string) => void;
  onSelectAllHookLab: () => void;
  onClearHookLabSelection: () => void;
  onAcceptHookLabOption: (optionId: string) => void;
  onDeleteHookLabOption: (optionId: string) => void;
  onApplyHookLab: (hook: string, optionId?: string) => void;
  onCreateHookLabVariants: () => void;
  media?: CandidateMediaState;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
  /** Draft overlay/style/cues differ from the last produced job spec. */
  draftDiffersFromRendered?: boolean;
  maxClipPoolSize?: number;
  canAddClips?: boolean;
  reassembleBusy?: boolean;
  onOpenClipPicker?: () => void;
  onReassembleClips?: () => void;
};

function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  return `${sec.toFixed(1)}s`;
}

function resolveLaneTag(candidate: PostCandidate): string | null {
  if (candidate.variant_kind) {
    return (
      REEL_VARIANT_LABELS[candidate.variant_kind as ReelVariantKind] ?? candidate.variant_kind
    );
  }
  return candidate.selected_series ?? null;
}

function ProductionStatusTag({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ');
  const tone =
    status === 'produced'
      ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200'
      : status === 'queued' || status === 'rendering'
        ? 'border-amber-500/50 bg-amber-500/20 text-amber-100'
        : status === 'failed' || status === 'needs_manual_production'
          ? 'border-[var(--bad)]/50 bg-[var(--bad)]/20 text-[var(--bad)]'
          : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]';

  return (
    <span
      className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}

function ReelPreviewStats({
  durationSec,
  assetCount,
  laneTag,
  status,
}: {
  durationSec: number | null;
  assetCount: number;
  laneTag?: string | null;
  status?: string | null;
}) {
  const dur = formatDuration(durationSec);
  const hasTextStats = dur || assetCount > 0;
  const hasTags = laneTag || status;
  if (!hasTextStats && !hasTags) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {hasTextStats && (
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--muted)]">
          {dur && <span>{dur}</span>}
          {dur && assetCount > 0 && <span aria-hidden>·</span>}
          {assetCount > 0 && (
            <span>
              {assetCount} asset{assetCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
      {hasTextStats && hasTags && (
        <span className="hidden text-[var(--border)] sm:inline" aria-hidden>
          ·
        </span>
      )}
      {laneTag && (
        <span
          className="inline-block max-w-[9rem] shrink truncate rounded-sm border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200 sm:max-w-[12rem]"
          title={laneTag}
        >
          {laneTag}
        </span>
      )}
      {status && <ProductionStatusTag status={status} />}
    </div>
  );
}

function IconOpenMp4({ className }: { className?: string }) {
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
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function IconDownload({ className }: { className?: string }) {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function formatSecInput(sec: number): string {
  if (!Number.isFinite(sec)) return '0';
  return String(Math.round(sec * 10) / 10);
}

function overlayPreviewPositionClass(position: ReelRenderTextStyle['position']): string {
  switch (position) {
    case 'top':
      return 'top-[8%]';
    case 'center':
      return 'top-1/2 -translate-y-1/2';
    case 'top_third':
    default:
      return 'top-[16.67%] -translate-y-1/2';
  }
}

function OverlayPreviewLayer({
  text,
  style,
  previewOnly = false,
}: {
  text: string;
  style: ReelRenderTextStyle;
  previewOnly?: boolean;
}) {
  return (
    <div
      className={`pointer-events-none absolute w-[80%] max-w-sm ${style.centered ? 'left-1/2 -translate-x-1/2' : 'left-[5%]'} ${overlayPreviewPositionClass(style.position)}`}
      aria-hidden
    >
      {previewOnly ? (
        <p className="mb-1 rounded-sm bg-black/70 px-1.5 py-0.5 text-center text-[9px] font-medium uppercase tracking-wide text-amber-200">
          Preview only — re-render to burn in
        </p>
      ) : null}
      <p
        className="whitespace-pre-wrap font-semibold"
        style={{
          color: style.font_color,
          fontSize: `${Math.max(12, Math.round(style.fontsize * 0.35))}px`,
          lineHeight: `${Math.max(1.1, 1 + style.line_spacing / 40)}`,
          textAlign: style.centered ? 'center' : 'left',
          textShadow:
            style.outline_width > 0
              ? `0 0 ${style.outline_width}px ${style.outline_color}, 0 0 ${style.outline_width * 2}px ${style.outline_color}`
              : undefined,
        }}
      >
        {text}
      </p>
    </div>
  );
}

function CollapsibleSection({
  title,
  hint,
  badge,
  defaultOpen = false,
  headerAction,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string;
  defaultOpen?: boolean;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {title}
            </span>
            {badge ? (
              <span className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text)]">
                {badge}
              </span>
            ) : null}
          </div>
          {hint ? (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">{hint}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerAction}
          <span
            className="text-[10px] text-[var(--muted)] transition-transform group-open:rotate-180"
            aria-hidden
          >
            ▼
          </span>
        </div>
      </summary>
      <div className="space-y-3 border-t border-[var(--border)] px-4 py-3">{children}</div>
    </details>
  );
}

function TimedOverlayCueEditor({
  cues,
  currentTimeSec,
  durationSec,
  overlayEndSec,
  disabled,
  onChange,
}: {
  cues: ReelTimedOverlayCue[];
  currentTimeSec: number | null;
  durationSec: number | null;
  overlayEndSec?: number | null;
  disabled?: boolean;
  onChange: (cues: ReelTimedOverlayCue[]) => void;
}) {
  const playhead = currentTimeSec ?? 0;

  const updateCue = (index: number, patch: Partial<ReelTimedOverlayCue>) => {
    onChange(cues.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)));
  };

  const removeCue = (index: number) => {
    onChange(cues.filter((_, i) => i !== index));
  };

  return (
    <>
      {cues.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          No timed cues yet. Scrub the rendered video and add a cue at the playhead.
        </p>
      ) : (
        <ul className="space-y-3">
          {cues.map((cue, index) => (
            <li
              key={`cue-${index}`}
              className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  Start
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    disabled={disabled}
                    value={formatSecInput(cue.start_sec)}
                    onChange={(e) =>
                      updateCue(index, { start_sec: Number(e.target.value) || 0 })
                    }
                    className="w-16 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-xs tabular-nums text-[var(--text)] disabled:opacity-50"
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled || currentTimeSec == null}
                  onClick={() => updateCue(index, { start_sec: +playhead.toFixed(1) })}
                  className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  Use playhead
                </button>
                <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
                  End
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    disabled={disabled}
                    value={formatSecInput(cue.end_sec)}
                    onChange={(e) =>
                      updateCue(index, { end_sec: Number(e.target.value) || 0 })
                    }
                    className="w-16 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-xs tabular-nums text-[var(--text)] disabled:opacity-50"
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled || currentTimeSec == null}
                  onClick={() => updateCue(index, { end_sec: +playhead.toFixed(1) })}
                  className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  Use playhead
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeCue(index)}
                  className="ml-auto rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--bad)] hover:bg-[var(--bad)]/10 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              <input
                type="text"
                disabled={disabled}
                value={cue.text}
                onChange={(e) => updateCue(index, { text: e.target.value })}
                placeholder="On-screen text for this time range…"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] disabled:opacity-50"
              />
            </li>
          ))}
        </ul>
      )}
      {timedCueOverlapsOverlayEnd(cues, overlayEndSec) && (
        <p className="text-xs text-[var(--warn)]">
          A cue starts before the overlay end — both may show at once in the render.
        </p>
      )}
      {currentTimeSec != null && (
        <p className="text-[11px] tabular-nums text-[var(--muted)]">
          Playhead: {formatSecInput(currentTimeSec)}s
          {durationSec != null ? ` / ${formatSecInput(durationSec)}s` : ''}
        </p>
      )}
    </>
  );
}

function ReelProductionBar({
  previewUrl,
  downloadUrl,
  renderDisabled,
  renderLabel,
  renderIsReRender = false,
  draftDiffersFromRendered = false,
  onRender,
  compact = false,
}: {
  previewUrl: string | null;
  downloadUrl: string | null;
  renderDisabled: boolean;
  renderLabel: string;
  renderIsReRender?: boolean;
  draftDiffersFromRendered?: boolean;
  onRender: () => void;
  compact?: boolean;
}) {
  const renderBtnClass = renderIsReRender
    ? compact
      ? 'shrink-0 rounded-md border border-[var(--warn)]/50 bg-[var(--warn)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--warn)] transition-colors hover:bg-[var(--warn)]/20 disabled:cursor-not-allowed disabled:opacity-50'
      : 'shrink-0 rounded-lg border border-[var(--warn)] bg-[var(--warn)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
    : compact
      ? 'shrink-0 rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50'
      : 'shrink-0 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

  const openBtnClass = compact
    ? 'inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]'
    : 'inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]';

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
      {draftDiffersFromRendered && previewUrl ? (
        <p className="mb-2 text-[11px] leading-snug text-[var(--warn)]">
          Draft differs from rendered MP4 — overlay on the video is preview only until you re-render.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {downloadUrl && (
          <a
            href={downloadUrl}
            className={openBtnClass}
            aria-label="Download rendered MP4"
            title="Download rendered MP4"
          >
            <IconDownload />
          </a>
        )}
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className={openBtnClass}
            aria-label="Open rendered MP4"
            title="Open rendered MP4"
          >
            <IconOpenMp4 />
          </a>
        )}
        <button type="button" disabled={renderDisabled} onClick={onRender} className={renderBtnClass}>
          {renderLabel}
        </button>
      </div>
    </div>
  );
}

function RenderedStage({
  previewUrl,
  posterUrl,
  large,
  isRenderActive = false,
  videoRef,
  onRegisterActivateStream,
  draftOverlay,
  draftOverlayEndSec,
  draftTimedCues,
  draftStyle,
  overlayFallbacks,
  draftDiffersFromRendered = false,
  onCurrentTimeChange,
}: {
  previewUrl: string | null;
  posterUrl: string | null;
  large?: boolean;
  isRenderActive?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  draftOverlay?: string;
  draftOverlayEndSec?: number | null;
  draftTimedCues?: ReelTimedOverlayCue[];
  draftStyle?: ReelRenderTextStyle;
  overlayFallbacks?: { titleOverlay?: string | null; hook?: string | null };
  draftDiffersFromRendered?: boolean;
  onCurrentTimeChange?: (timeSec: number) => void;
}) {
  const [currentTime, setCurrentTime] = useState(0);

  const previewOverlay = useMemo(() => {
    if (!draftStyle) return null;
    return resolveOverlayPreviewText({
      overlayLines: parseReelOverlayDraft(draftOverlay ?? ''),
      overlayEndSec: draftOverlayEndSec ?? null,
      timedCues: draftTimedCues ?? [],
      timeSec: currentTime,
      fallbacks: overlayFallbacks,
    });
  }, [
    currentTime,
    draftOverlay,
    draftOverlayEndSec,
    draftStyle,
    draftTimedCues,
    overlayFallbacks,
  ]);

  useEffect(() => {
    if (!previewUrl || !onRegisterActivateStream) return;
    onRegisterActivateStream(() => {
      const el = videoRef?.current;
      if (!el) return;
      if (el.paused) void el.play().catch(() => undefined);
      else el.pause();
    });
  }, [onRegisterActivateStream, previewUrl, videoRef]);

  const shellClass = large
    ? 'flex h-full min-h-0 w-full items-center justify-center'
    : 'flex w-full items-center justify-center';
  const videoClass = large
    ? 'h-full max-h-full w-auto max-w-full rounded-xl border border-[var(--border)] bg-black object-contain shadow-lg'
    : 'max-h-80 w-full max-w-sm rounded-md border border-[var(--border)] bg-black';

  return (
    <div className={shellClass}>
      <div
        className={
          large
            ? 'relative flex h-full max-h-full flex-col items-center justify-center gap-3'
            : 'relative w-full'
        }
      >
        {previewUrl ? (
          <>
            <video
              key={previewUrl}
              ref={videoRef}
              src={previewUrl}
              poster={posterUrl ?? undefined}
              controls
              playsInline
              className={videoClass}
              style={large ? { aspectRatio: '9 / 16' } : undefined}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setCurrentTime(t);
                onCurrentTimeChange?.(t);
              }}
              onLoadedMetadata={(e) => {
                const t = e.currentTarget.currentTime;
                setCurrentTime(t);
                onCurrentTimeChange?.(t);
              }}
            />
            {draftDiffersFromRendered && previewOverlay?.text && draftStyle && (
              <OverlayPreviewLayer
                text={previewOverlay.text}
                style={draftStyle}
                previewOnly
              />
            )}
          </>
        ) : isRenderActive ? (
          <div
            className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] text-center ${
              large ? 'aspect-[9/16] h-full max-h-full w-auto max-w-full px-6' : 'w-full max-w-sm px-4 py-12'
            }`}
          >
            <p className="text-sm font-medium text-[var(--text)]">Rendering…</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Final MP4 will appear here when done</p>
          </div>
        ) : (
          <div
            className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] text-center ${
              large ? 'aspect-[9/16] h-full max-h-full w-auto max-w-full px-6' : 'w-full max-w-sm px-4 py-12'
            }`}
          >
            <p className="text-sm font-medium text-[var(--text)]">No render yet</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Use Render to create the final MP4</p>
          </div>
        )}
      </div>
    </div>
  );
}

function sourceGridColsClass(n: number): string {
  if (n <= 1) return 'grid-cols-1';
  if (n === 2) return 'grid-cols-2';
  if (n === 3) return 'grid-cols-3';
  if (n === 4) return 'grid-cols-2';
  if (n <= 9) return 'grid-cols-3';
  return 'grid-cols-4';
}

function SourceAssetsGrid({
  candidate,
  media,
  videoRef,
  onRegisterActivateStream,
  onRemoveReviewAsset,
}: {
  candidate: PostCandidate;
  media: CandidateMediaState;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
}) {
  const { files, loading, error } = media;
  const firstVideoIdx = files.findIndex((f) => f.mimeType.startsWith('video/'));
  const canDetachSource =
    (candidate.source_asset_ids?.length ?? 0) > 0 && Boolean(candidate.review_drive_folder_id);

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading source assets…</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--bad)]">{error}</p>;
  }
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-[var(--muted)]">
        <p>No source assets linked to this reel.</p>
        {candidate.review_drive_folder_url && (
          <a
            href={candidate.review_drive_folder_url}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline"
          >
            Open review folder
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      className={`grid h-full w-full auto-rows-fr gap-3 ${sourceGridColsClass(files.length)}`}
    >
      {files.map((f, i) => (
        <div
          key={f.id}
          className="relative flex min-h-0 min-w-0 items-center justify-center"
        >
          {onRemoveReviewAsset && canDetachSource && (
            <ReviewMediaTrashButton file={f} onRemove={onRemoveReviewAsset} />
          )}
          <MainMediaPreview
            file={f}
            candidateId={candidate.id}
            videoRef={i === firstVideoIdx ? videoRef : undefined}
            onRegisterActivateStream={
              i === firstVideoIdx ? onRegisterActivateStream : undefined
            }
            compact
          />
        </div>
      ))}
    </div>
  );
}

function IconInfo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function HookLabOptionDetails({ option }: { option: ReelHookLabPersistedOption }) {
  const hasDetails =
    option.angle || option.why_it_could_work || option.discovery_fit || option.risk;
  if (!hasDetails) return null;

  return (
    <div className="group/hookinfo relative shrink-0">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        aria-label="Hook details"
        title="Hook details"
      >
        <IconInfo />
      </button>
      <div className="pointer-events-none invisible absolute right-0 top-full z-50 mt-1 w-[min(90vw,20rem)] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 opacity-0 shadow-xl transition-opacity group-hover/hookinfo:pointer-events-auto group-hover/hookinfo:visible group-hover/hookinfo:opacity-100 group-focus-within/hookinfo:pointer-events-auto group-focus-within/hookinfo:visible group-focus-within/hookinfo:opacity-100">
        <div className="space-y-2 text-xs leading-relaxed text-[var(--text)]">
          {option.angle ? (
            <p>
              <span className="font-semibold uppercase tracking-wide text-violet-200/90">
                Angle
              </span>
              <br />
              {option.angle}
            </p>
          ) : null}
          {option.why_it_could_work ? (
            <p>
              <span className="font-semibold text-[var(--muted)]">Why it could work</span>
              <br />
              {option.why_it_could_work}
            </p>
          ) : null}
          {option.discovery_fit ? (
            <p>
              <span className="font-semibold text-[var(--muted)]">Discovery</span>
              <br />
              {option.discovery_fit}
            </p>
          ) : null}
          {option.risk ? (
            <p className="text-amber-200/90">
              <span className="font-semibold">Risk</span>
              <br />
              {option.risk}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function HookLabOptionRow({
  option,
  checked,
  isBusy,
  busyAction,
  busyOptionId,
  showSelection,
  onToggleSelection,
  onAccept,
  onDelete,
  onApply,
}: {
  option: ReelHookLabPersistedOption;
  checked: boolean;
  isBusy: boolean;
  busyAction?: 'accept' | 'delete' | 'apply' | null;
  busyOptionId?: string | null;
  showSelection?: boolean;
  onToggleSelection?: (hook: string) => void;
  onAccept?: (optionId: string) => void;
  onDelete?: (optionId: string) => void;
  onApply?: (hook: string, optionId: string) => void;
}) {
  const isRowBusy = isBusy && busyOptionId === option.id;
  const acceptLabel = isRowBusy && busyAction === 'accept' ? 'Accepting…' : 'Accept';
  const deleteLabel = isRowBusy && busyAction === 'delete' ? 'Deleting…' : 'Delete';
  const applyLabel = isRowBusy && busyAction === 'apply' ? 'Applying…' : 'Use on reel';

  return (
    <li
      className={`rounded-lg border px-2.5 py-2 ${
        checked
          ? 'border-violet-500/50 bg-violet-500/10'
          : 'border-[var(--border)] bg-[var(--surface)]'
      }`}
    >
      <div className="flex items-start gap-2">
        {showSelection && onToggleSelection ? (
          <input
            type="checkbox"
            checked={checked}
            disabled={isBusy}
            onChange={() => onToggleSelection(option.hook)}
            className="mt-1 shrink-0"
            aria-label={`Select hook: ${option.hook}`}
          />
        ) : null}
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-[var(--text)]">
          {option.hook}
        </p>
        <HookLabOptionDetails option={option} />
      </div>
      {(onAccept || onDelete || onApply) && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-0">
          {onAccept ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onAccept(option.id)}
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 hover:border-emerald-400 disabled:opacity-50"
            >
              {acceptLabel}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onDelete(option.id)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted)] hover:border-[var(--bad)] hover:text-[var(--bad)] disabled:opacity-50"
            >
              {deleteLabel}
            </button>
          ) : null}
          {onApply ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onApply(option.hook, option.id)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
            >
              {applyLabel}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function HookLabPanel({
  pending,
  accepted,
  selected,
  notes,
  busy,
  busyOptionId,
  error,
  onNotesChange,
  onGenerate,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onAccept,
  onDelete,
  onApply,
  onCreateVariants,
  layoutVariant = 'embedded',
}: {
  pending: ReelHookLabPersistedOption[];
  accepted: ReelHookLabPersistedOption[];
  selected: string[];
  notes: string;
  busy: ReelProductionWorkspaceProps['hookLabBusy'];
  busyOptionId?: string | null;
  error: string | null;
  onNotesChange: (notes: string) => void;
  onGenerate: () => void;
  onToggleSelection: (hook: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onAccept: (optionId: string) => void;
  onDelete: (optionId: string) => void;
  onApply: (hook: string, optionId?: string) => void;
  onCreateVariants: () => void;
  layoutVariant?: 'column' | 'embedded';
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isBusy = busy != null;
  const isColumn = layoutVariant === 'column';
  const hasBatch = pending.length > 0 || accepted.length > 0;
  const generateLabel =
    busy === 'generate'
      ? 'Generating 9 hooks…'
      : hasBatch
        ? 'Generate another 9'
        : 'Generate 9 hooks';
  const rowBusyAction =
    busy === 'accept' || busy === 'delete' || busy === 'apply' ? busy : null;

  const controls = (
    <div className={`flex flex-col gap-2 ${isColumn ? 'pb-3' : ''}`}>
      <label className="block text-[11px] font-medium text-[var(--muted)]">
        Notes for next batch
        <textarea
          value={notes}
          disabled={isBusy}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          placeholder="e.g. more family confusion, less countdown…"
          className="mt-1 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--muted)] disabled:opacity-50"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={onGenerate}
          className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:border-violet-400 disabled:opacity-50"
        >
          {generateLabel}
        </button>
        {pending.length > 0 && (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={onSelectAll}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={isBusy || selected.length === 0}
              onClick={onClearSelection}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={isBusy || selected.length === 0}
              onClick={onCreateVariants}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
            >
              {busy === 'variants'
                ? 'Creating variants…'
                : `Create selected variants (${selected.length})`}
            </button>
          </>
        )}
      </div>
    </div>
  );

  const hookList =
    pending.length === 0 && accepted.length === 0 ? (
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Generate nine discovery POV hooks for this exact reel. Accept the ones you like, delete the
        rest, then generate another batch with notes.
      </p>
    ) : (
      <div
        className={
          isColumn
            ? 'scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1'
            : 'max-h-[min(50vh,24rem)] space-y-4 overflow-y-auto pr-1'
        }
      >
        {pending.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Current batch ({pending.length})
            </h3>
            <ul className="space-y-2">
              {pending.map((opt) => (
                <HookLabOptionRow
                  key={opt.id}
                  option={opt}
                  checked={selectedSet.has(opt.hook)}
                  isBusy={isBusy}
                  busyAction={rowBusyAction}
                  busyOptionId={busyOptionId}
                  showSelection
                  onToggleSelection={onToggleSelection}
                  onAccept={onAccept}
                  onDelete={onDelete}
                  onApply={onApply}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {accepted.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80">
              Accepted ({accepted.length})
            </h3>
            <ul className="space-y-2">
              {accepted.map((opt) => (
                <HookLabOptionRow
                  key={opt.id}
                  option={opt}
                  checked={selectedSet.has(opt.hook)}
                  isBusy={isBusy}
                  busyAction={rowBusyAction}
                  busyOptionId={busyOptionId}
                  showSelection
                  onToggleSelection={onToggleSelection}
                  onApply={onApply}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );

  if (isColumn) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-3 pb-2">
          {controls}
          {error ? (
            <p className="mt-2 rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-2.5 py-2 text-xs text-[var(--bad)]">
              {error}
            </p>
          ) : null}
          {busy === 'load' ? (
            <p className="mt-2 text-xs text-[var(--muted)]">Loading saved hooks…</p>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">{hookList}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {controls}
      {error ? (
        <p className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-2.5 py-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      ) : null}
      {busy === 'load' ? (
        <p className="text-xs text-[var(--muted)]">Loading saved hooks…</p>
      ) : null}
      {hookList}
    </div>
  );
}

type HookLabPanelProps = Parameters<typeof HookLabPanel>[0];

type ReelWorkspaceColumnKey = 'hookLab' | 'settings';

function buildReelWorkspaceGridCols(
  showHookLab: boolean,
  collapsed: Record<ReelWorkspaceColumnKey, boolean>,
): string {
  const stage = 'minmax(0,1fr)';
  const settings = columnGridWidth(collapsed.settings, 'minmax(300px,380px)');
  if (!showHookLab) return `${stage} ${settings}`;
  const hookLab = columnGridWidth(collapsed.hookLab, 'minmax(340px,460px)');
  return `${stage} ${hookLab} ${settings}`;
}

function HookLabColumn({
  optionCount,
  collapsed,
  onToggleCollapsed,
  ...panelProps
}: HookLabPanelProps & {
  optionCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  if (collapsed) {
    return (
      <CollapsibleColumnFrame
        label="Hook Lab"
        badge={optionCount > 0 ? optionCount : null}
        collapsed
        togglePlacement="start"
        onToggleCollapsed={onToggleCollapsed}
        borderSide="both"
      >
        {null}
      </CollapsibleColumnFrame>
    );
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-x border-[var(--border)] bg-[var(--surface)]">
      <div className="flex shrink-0 border-b border-[var(--border)] px-2.5 py-1.5">
        <ColumnPanelToggle
          label="Hook Lab"
          collapsed={false}
          placement="start"
          onClick={onToggleCollapsed}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text)]">
            Hook Lab
          </h2>
          {optionCount > 0 ? (
            <span className="rounded-sm border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-violet-200">
              {optionCount}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
          Discovery POV hooks for this reel. Same clips — trial overlay text.
        </p>
      </div>
      <HookLabPanel {...panelProps} layoutVariant="column" />
      </div>
    </aside>
  );
}

function OperatorPanel({
  isClipReel,
  draftOverlay,
  draftOverlayEndSec,
  draftTimedCues,
  draftStyle,
  styleBusy,
  variantBusy,
  currentTimeSec,
  durationSec,
  onOverlayChange,
  onOverlayEndSecChange,
  onTimedCuesChange,
  onStyleChange,
  onCreateVariant,
  includeHookLab = true,
  hookLabPending,
  hookLabAccepted,
  hookLabSelected,
  hookLabNotes,
  hookLabBusy,
  hookLabBusyOptionId,
  hookLabError,
  onHookLabNotesChange,
  onGenerateHookLab,
  onToggleHookLabSelection,
  onSelectAllHookLab,
  onClearHookLabSelection,
  onAcceptHookLabOption,
  onDeleteHookLabOption,
  onApplyHookLab,
  onCreateHookLabVariants,
  clips,
  reasoningEntries,
  maxClipPoolSize,
  canAddClips,
  reassembleBusy,
  onOpenClipPicker,
  onReassembleClips,
}: Pick<
  ReelProductionWorkspaceProps,
  | 'isClipReel'
  | 'draftOverlay'
  | 'draftOverlayEndSec'
  | 'draftTimedCues'
  | 'draftStyle'
  | 'styleBusy'
  | 'variantBusy'
  | 'durationSec'
  | 'onOverlayChange'
  | 'onOverlayEndSecChange'
  | 'onTimedCuesChange'
  | 'onStyleChange'
  | 'onCreateVariant'
  | 'hookLabPending'
  | 'hookLabAccepted'
  | 'hookLabSelected'
  | 'hookLabNotes'
  | 'hookLabBusy'
  | 'hookLabBusyOptionId'
  | 'hookLabError'
  | 'onHookLabNotesChange'
  | 'onGenerateHookLab'
  | 'onToggleHookLabSelection'
  | 'onSelectAllHookLab'
  | 'onClearHookLabSelection'
  | 'onAcceptHookLabOption'
  | 'onDeleteHookLabOption'
  | 'onApplyHookLab'
  | 'onCreateHookLabVariants'
  | 'clips'
  | 'reasoningEntries'
  | 'maxClipPoolSize'
  | 'canAddClips'
  | 'reassembleBusy'
  | 'onOpenClipPicker'
  | 'onReassembleClips'
> & { currentTimeSec: number | null; includeHookLab?: boolean }) {
  const playhead = currentTimeSec ?? 0;
  const timedCueCount = draftTimedCues.length;

  return (
    <div className="flex flex-col gap-3">
      {isClipReel && (
        <CollapsibleSection
          title="Text style"
          hint="Applies to static overlay and timed cues in the rendered reel."
          defaultOpen={false}
        >
          <ReelTextStyleFields style={draftStyle} onChange={onStyleChange} disabled={styleBusy} />
        </CollapsibleSection>
      )}

      {isClipReel && (
        <CollapsibleSection
          title="Static overlay text"
          hint="Leave end empty to show for the whole reel, or until timed cues replace it."
          defaultOpen
        >
          <textarea
            value={draftOverlay}
            disabled={styleBusy}
            onChange={(e) => onOverlayChange(e.target.value)}
            rows={4}
            placeholder="On-screen text for the reel…"
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base leading-relaxed text-[var(--text)] placeholder:text-[var(--muted)] disabled:opacity-50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
              End at (s)
              <input
                type="number"
                min={0}
                step={0.1}
                disabled={styleBusy}
                value={draftOverlayEndSec != null ? formatSecInput(draftOverlayEndSec) : ''}
                placeholder="—"
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  onOverlayEndSecChange(raw === '' ? null : Number(raw) || null);
                }}
                className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs tabular-nums text-[var(--text)] disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              disabled={styleBusy || currentTimeSec == null}
              onClick={() => onOverlayEndSecChange(+playhead.toFixed(1))}
              className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              Use playhead
            </button>
          </div>
        </CollapsibleSection>
      )}

      {isClipReel && (
        <CollapsibleSection
          title="Timed text"
          hint="Set an overlay end time to hand off to timed cues after the intro."
          badge={timedCueCount > 0 ? `${timedCueCount} cue${timedCueCount === 1 ? '' : 's'}` : undefined}
          defaultOpen={timedCueCount > 0 || draftOverlayEndSec != null}
          headerAction={
            <button
              type="button"
              disabled={styleBusy || timedCueCount >= REEL_TIMED_OVERLAY_MAX_CUES}
              onClick={(e) => {
                e.preventDefault();
                const start = Math.max(0, playhead);
                const end =
                  durationSec != null ? Math.min(durationSec, start + 2) : start + 2;
                onTimedCuesChange([
                  ...draftTimedCues,
                  {
                    start_sec: +start.toFixed(1),
                    end_sec: +Math.max(start + 0.5, end).toFixed(1),
                    text: '',
                  },
                ]);
              }}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
            >
              Add cue
            </button>
          }
        >
          <TimedOverlayCueEditor
            cues={draftTimedCues}
            currentTimeSec={currentTimeSec}
            durationSec={durationSec}
            overlayEndSec={draftOverlayEndSec}
            disabled={styleBusy}
            onChange={onTimedCuesChange}
          />
        </CollapsibleSection>
      )}

      {isClipReel && includeHookLab && (
        <CollapsibleSection
          title="Hook Lab"
          hint="Generate 9 discovery POV hooks. Accept, delete, or regenerate with notes."
          badge={
            hookLabPending.length + hookLabAccepted.length > 0
              ? String(hookLabPending.length + hookLabAccepted.length)
              : undefined
          }
          defaultOpen={false}
        >
          <HookLabPanel
            pending={hookLabPending}
            accepted={hookLabAccepted}
            selected={hookLabSelected}
            notes={hookLabNotes}
            busy={hookLabBusy}
            busyOptionId={hookLabBusyOptionId}
            error={hookLabError}
            onNotesChange={onHookLabNotesChange}
            onGenerate={onGenerateHookLab}
            onToggleSelection={onToggleHookLabSelection}
            onSelectAll={onSelectAllHookLab}
            onClearSelection={onClearHookLabSelection}
            onAccept={onAcceptHookLabOption}
            onDelete={onDeleteHookLabOption}
            onApply={onApplyHookLab}
            onCreateVariants={onCreateHookLabVariants}
          />
        </CollapsibleSection>
      )}

      {isClipReel && (
        <CollapsibleSection
          title="Variants"
          hint="Reuses pre-tagged clips. Creates a new candidate and queues a render."
          defaultOpen={false}
        >
          <div className="flex flex-wrap gap-2">
            {REEL_VARIANT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={!!variantBusy}
                onClick={() => onCreateVariant(kind)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
              >
                {variantBusy === kind ? 'Creating…' : REEL_VARIANT_LABELS[kind]}
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {isClipReel && (
        <CollapsibleSection
          title="Clip pool"
          hint="Add ready clips, then rerun structure analysis on this candidate."
          badge={clips?.length ? String(clips.length) : undefined}
          defaultOpen
          headerAction={
            canAddClips && onOpenClipPicker ? (
              <button
                type="button"
                disabled={!!reassembleBusy}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenClipPicker();
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
              >
                Add clips
              </button>
            ) : undefined
          }
        >
          {(!clips || clips.length === 0) && (
            <p className="text-sm text-[var(--muted)]">
              No clips in pool yet. Add ready clips from the library, then rerun structure.
            </p>
          )}
          {clips && clips.length > 0 && (
            <ul className="space-y-2 text-sm text-[var(--text)]">
              {clips.map((c, i) => (
                <li key={c.clip_id ?? i} className="leading-relaxed">
                  <span className="font-medium text-[var(--muted)]">#{i + 1}</span>{' '}
                  {(c.end_sec - c.start_sec).toFixed(1)}s
                  {c.why ? <span className="text-[var(--muted)]"> — {c.why}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {maxClipPoolSize != null && (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Pool limit: {clips?.length ?? 0}/{maxClipPoolSize} clips
            </p>
          )}
          {onReassembleClips && (clips?.length ?? 0) > 0 && (
            <button
              type="button"
              disabled={!!reassembleBusy}
              onClick={() => onReassembleClips()}
              className="mt-3 rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] disabled:opacity-50"
            >
              {reassembleBusy ? 'Reassembling…' : 'Rerun structure analysis'}
            </button>
          )}
        </CollapsibleSection>
      )}

      {clips && clips.length > 0 && !isClipReel && (
        <CollapsibleSection
          title="Clips"
          badge={String(clips.length)}
          defaultOpen={false}
        >
          <ul className="space-y-2 text-sm text-[var(--text)]">
            {clips.map((c, i) => (
              <li key={c.clip_id ?? i} className="leading-relaxed">
                <span className="font-medium text-[var(--muted)]">#{i + 1}</span>{' '}
                {(c.end_sec - c.start_sec).toFixed(1)}s
                {c.why ? <span className="text-[var(--muted)]"> — {c.why}</span> : null}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {reasoningEntries.length > 0 && (
        <CollapsibleSection title="Assembly reasoning" defaultOpen={false}>
          <dl className="space-y-3 text-sm">
            {reasoningEntries.map(([label, text]) => (
              <div key={label}>
                <dt className="font-medium text-[var(--text)]">{label}</dt>
                <dd className="mt-0.5 leading-relaxed text-[var(--muted)]">{text}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleSection>
      )}
    </div>
  );
}

function WorkspaceLayout(props: ReelProductionWorkspaceProps) {
  const hasRendered = Boolean(props.previewUrl);
  const [stageTab, setStageTab] = useState<StageTab>('source');
  const [renderedTimeSec, setRenderedTimeSec] = useState<number | null>(null);
  const [reelColumnsCollapsed, setReelColumnsCollapsed] = useState<
    Record<ReelWorkspaceColumnKey, boolean>
  >({
    hookLab: true,
    settings: true,
  });
  const laneTag = resolveLaneTag(props.candidate);
  const assetCount = props.media?.files?.length ?? props.clipCount;

  useEffect(() => {
    setStageTab('source');
    setRenderedTimeSec(null);
  }, [props.candidate.id]);

  const currentTimeSec = stageTab === 'rendered' ? renderedTimeSec : null;
  const showHookLabColumn = props.isClipReel;

  const toggleReelColumn = useCallback((key: ReelWorkspaceColumnKey) => {
    setReelColumnsCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const reelGridTemplate = buildReelWorkspaceGridCols(showHookLabColumn, reelColumnsCollapsed);

  const hookLabPanelProps = {
    pending: props.hookLabPending,
    accepted: props.hookLabAccepted,
    selected: props.hookLabSelected,
    notes: props.hookLabNotes,
    busy: props.hookLabBusy,
    busyOptionId: props.hookLabBusyOptionId,
    error: props.hookLabError,
    onNotesChange: props.onHookLabNotesChange,
    onGenerate: props.onGenerateHookLab,
    onToggleSelection: props.onToggleHookLabSelection,
    onSelectAll: props.onSelectAllHookLab,
    onClearSelection: props.onClearHookLabSelection,
    onAccept: props.onAcceptHookLabOption,
    onDelete: props.onDeleteHookLabOption,
    onApply: props.onApplyHookLab,
    onCreateVariants: props.onCreateHookLabVariants,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: reelGridTemplate }}
      >
        <div className="flex min-h-0 min-w-0 flex-col border-r border-[var(--border)]">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-1">
            <div className="flex shrink-0">
              <button
                type="button"
                onClick={() => setStageTab('source')}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors sm:px-4 sm:py-2.5 ${
                  stageTab === 'source'
                    ? 'border-[var(--accent)] text-[var(--text)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Source clips
              </button>
              <button
                type="button"
                onClick={() => setStageTab('rendered')}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors sm:px-4 sm:py-2.5 ${
                  stageTab === 'rendered'
                    ? 'border-[var(--accent)] text-[var(--text)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                } ${!hasRendered && stageTab !== 'rendered' ? 'opacity-70' : ''}`}
              >
                Rendered
                {hasRendered ? null : (
                  <span className="ml-1.5 text-[10px] font-normal text-[var(--muted)]">
                    (empty)
                  </span>
                )}
              </button>
            </div>
            <div className="ml-auto min-w-0 max-w-full">
              <ReelPreviewStats
                durationSec={props.durationSec}
                assetCount={assetCount}
                laneTag={laneTag}
                status={props.job?.status ?? null}
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4 lg:p-6">
            {stageTab === 'rendered' ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <RenderedStage
                  previewUrl={props.previewUrl}
                  posterUrl={props.posterUrl}
                  large
                  isRenderActive={props.isRenderActive}
                  videoRef={props.videoRef}
                  onRegisterActivateStream={props.onRegisterActivateStream}
                  draftOverlay={props.draftOverlay}
                  draftOverlayEndSec={props.draftOverlayEndSec}
                  draftTimedCues={props.draftTimedCues}
                  draftStyle={props.draftStyle}
                  overlayFallbacks={props.overlayFallbacks}
                  draftDiffersFromRendered={props.draftDiffersFromRendered}
                  onCurrentTimeChange={setRenderedTimeSec}
                />
              </div>
            ) : props.media ? (
              <SourceAssetsGrid
                candidate={props.candidate}
                media={props.media}
                videoRef={props.videoRef}
                onRegisterActivateStream={props.onRegisterActivateStream}
                onRemoveReviewAsset={props.onRemoveReviewAsset}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">Source assets unavailable</p>
            )}
          </div>
          </div>
        </div>

        {showHookLabColumn ? (
          <HookLabColumn
            {...hookLabPanelProps}
            optionCount={props.hookLabPending.length + props.hookLabAccepted.length}
            collapsed={reelColumnsCollapsed.hookLab}
            onToggleCollapsed={() => toggleReelColumn('hookLab')}
          />
        ) : null}

        {reelColumnsCollapsed.settings ? (
          <CollapsibleColumnFrame
            label="Settings"
            collapsed
            togglePlacement="start"
            onToggleCollapsed={() => toggleReelColumn('settings')}
            borderSide="left"
          />
        ) : (
          <aside className="flex min-h-0 min-w-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
          <div className="flex shrink-0 border-b border-[var(--border)] px-2.5 py-1.5">
            <ColumnPanelToggle
              label="Settings"
              collapsed={false}
              placement="start"
              onClick={() => toggleReelColumn('settings')}
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ReelProductionBar
            previewUrl={props.previewUrl}
            downloadUrl={props.downloadUrl}
            renderDisabled={props.renderDisabled}
            renderLabel={props.renderLabel}
            renderIsReRender={props.renderIsReRender}
            draftDiffersFromRendered={props.draftDiffersFromRendered}
            onRender={props.onRender}
          />
          {(props.loading && !props.job) || props.error || props.renderMessage ? (
            <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
              {props.loading && !props.job && (
                <p className="text-xs text-[var(--muted)]">Loading render job…</p>
              )}
              {props.error && (
                <p className="text-xs whitespace-pre-wrap text-[var(--bad)]">{props.error}</p>
              )}
              {props.renderMessage && (
                <p className="text-xs text-[var(--warn)]">{props.renderMessage}</p>
              )}
              {props.job?.error_message && (
                <p className="text-xs whitespace-pre-wrap text-[var(--bad)]">
                  {props.job.error_message}
                </p>
              )}
            </div>
          ) : null}
          {props.isRenderActive && props.job && (
            <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
              <ReelRenderProgress
                jobStatus={props.job.status}
                renderLog={props.job.render_log}
                jobUpdatedAt={props.job.updated_at}
              />
            </div>
          )}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="p-4 pb-6">
              <OperatorPanel
                key={props.candidate.id}
                isClipReel={props.isClipReel}
                draftOverlay={props.draftOverlay}
                draftOverlayEndSec={props.draftOverlayEndSec}
                draftTimedCues={props.draftTimedCues}
                draftStyle={props.draftStyle}
                styleBusy={props.styleBusy}
                variantBusy={props.variantBusy}
                currentTimeSec={currentTimeSec}
                durationSec={props.durationSec}
                onOverlayChange={props.onOverlayChange}
                onOverlayEndSecChange={props.onOverlayEndSecChange}
                onTimedCuesChange={props.onTimedCuesChange}
                onStyleChange={props.onStyleChange}
                onCreateVariant={props.onCreateVariant}
                includeHookLab={false}
                hookLabPending={props.hookLabPending}
                hookLabAccepted={props.hookLabAccepted}
                hookLabSelected={props.hookLabSelected}
                hookLabNotes={props.hookLabNotes}
                hookLabBusy={props.hookLabBusy}
                hookLabBusyOptionId={props.hookLabBusyOptionId}
                hookLabError={props.hookLabError}
                onHookLabNotesChange={props.onHookLabNotesChange}
                onGenerateHookLab={props.onGenerateHookLab}
                onToggleHookLabSelection={props.onToggleHookLabSelection}
                onSelectAllHookLab={props.onSelectAllHookLab}
                onClearHookLabSelection={props.onClearHookLabSelection}
                onAcceptHookLabOption={props.onAcceptHookLabOption}
                onDeleteHookLabOption={props.onDeleteHookLabOption}
                onApplyHookLab={props.onApplyHookLab}
                onCreateHookLabVariants={props.onCreateHookLabVariants}
                clips={props.clips}
                reasoningEntries={props.reasoningEntries}
                maxClipPoolSize={props.maxClipPoolSize}
                canAddClips={props.canAddClips}
                reassembleBusy={props.reassembleBusy}
                onOpenClipPicker={props.onOpenClipPicker}
                onReassembleClips={props.onReassembleClips}
              />
            </div>
          </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}

function CompactLayout(props: ReelProductionWorkspaceProps) {
  const [renderedTimeSec, setRenderedTimeSec] = useState<number | null>(null);
  const laneTag = resolveLaneTag(props.candidate);
  const assetCount = props.media?.files?.length ?? props.clipCount;
  const hasRenderedPreview = Boolean(props.previewUrl);

  return (
    <section className="shrink-0 border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="flex justify-end border-b border-[var(--border)] px-4 py-1.5 lg:px-6">
        <ReelPreviewStats
          durationSec={props.durationSec}
          assetCount={assetCount}
          laneTag={laneTag}
          status={props.job?.status ?? null}
        />
      </div>
      {(props.loading && !props.job) || props.error || props.renderMessage ? (
        <div className="border-b border-[var(--border)] px-4 py-2 lg:px-6">
          {props.loading && !props.job && (
            <p className="text-xs text-[var(--muted)]">Loading render job…</p>
          )}
          {props.error && (
            <p className="text-xs whitespace-pre-wrap text-[var(--bad)]">{props.error}</p>
          )}
          {props.renderMessage && (
            <p className="text-xs text-[var(--warn)]">{props.renderMessage}</p>
          )}
        </div>
      ) : null}

      {props.job?.error_message && (
        <div className="border-b border-[var(--border)] px-4 py-2 lg:px-6">
          <p className="text-xs whitespace-pre-wrap text-[var(--bad)]">
            {props.job.error_message}
          </p>
        </div>
      )}

      <div className="space-y-3 px-4 py-3 lg:px-6">
        {props.isRenderActive && props.job && (
          <ReelRenderProgress
            jobStatus={props.job.status}
            renderLog={props.job.render_log}
            jobUpdatedAt={props.job.updated_at}
          />
        )}
        {props.previewUrl ? (
          <RenderedStage
            previewUrl={props.previewUrl}
            posterUrl={props.posterUrl}
            isRenderActive={props.isRenderActive}
            videoRef={props.videoRef}
            onRegisterActivateStream={props.onRegisterActivateStream}
            draftOverlay={props.draftOverlay}
            draftOverlayEndSec={props.draftOverlayEndSec}
            draftTimedCues={props.draftTimedCues}
            draftStyle={props.draftStyle}
            overlayFallbacks={props.overlayFallbacks}
            draftDiffersFromRendered={props.draftDiffersFromRendered}
            onCurrentTimeChange={setRenderedTimeSec}
          />
        ) : props.media ? (
          <SourceAssetsGrid
            candidate={props.candidate}
            media={props.media}
            videoRef={props.videoRef}
            onRegisterActivateStream={props.onRegisterActivateStream}
            onRemoveReviewAsset={props.onRemoveReviewAsset}
          />
        ) : (
          <RenderedStage
            previewUrl={null}
            posterUrl={null}
            isRenderActive={props.isRenderActive}
          />
        )}
      </div>

      {props.isClipReel ? (
        <div className="border-t border-[var(--border)]">
          <div className="scrollbar-thin max-h-[min(50vh,28rem)] space-y-3 overflow-y-auto px-4 pt-3 pb-3 lg:px-6">
            {hasRenderedPreview && (
              <CollapsibleSection
                title="Timed text"
                badge={
                  props.draftTimedCues.length > 0
                    ? `${props.draftTimedCues.length} cue${props.draftTimedCues.length === 1 ? '' : 's'}`
                    : undefined
                }
                defaultOpen={
                  props.draftTimedCues.length > 0 || props.draftOverlayEndSec != null
                }
                headerAction={
                  <button
                    type="button"
                    disabled={
                      props.styleBusy ||
                      props.draftTimedCues.length >= REEL_TIMED_OVERLAY_MAX_CUES
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      const start = Math.max(0, renderedTimeSec ?? 0);
                      const end =
                        props.durationSec != null
                          ? Math.min(props.durationSec, start + 2)
                          : start + 2;
                      props.onTimedCuesChange([
                        ...props.draftTimedCues,
                        {
                          start_sec: +start.toFixed(1),
                          end_sec: +Math.max(start + 0.5, end).toFixed(1),
                          text: '',
                        },
                      ]);
                    }}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
                  >
                    Add cue
                  </button>
                }
              >
                <TimedOverlayCueEditor
                  cues={props.draftTimedCues}
                  currentTimeSec={renderedTimeSec}
                  durationSec={props.durationSec}
                  overlayEndSec={props.draftOverlayEndSec}
                  disabled={props.styleBusy}
                  onChange={props.onTimedCuesChange}
                />
              </CollapsibleSection>
            )}
            <CollapsibleSection title="Static overlay text" defaultOpen>
              <textarea
                value={props.draftOverlay}
                disabled={props.styleBusy}
                onChange={(e) => props.onOverlayChange(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                  End at (s)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    disabled={props.styleBusy}
                    value={
                      props.draftOverlayEndSec != null
                        ? formatSecInput(props.draftOverlayEndSec)
                        : ''
                    }
                    placeholder="—"
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      props.onOverlayEndSecChange(raw === '' ? null : Number(raw) || null);
                    }}
                    className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-xs tabular-nums text-[var(--text)] disabled:opacity-50"
                  />
                </label>
                <button
                  type="button"
                  disabled={props.styleBusy || renderedTimeSec == null}
                  onClick={() =>
                    props.onOverlayEndSecChange(+(renderedTimeSec ?? 0).toFixed(1))
                  }
                  className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  Use playhead
                </button>
              </div>
            </CollapsibleSection>
            <CollapsibleSection title="Text style" defaultOpen={false}>
              <ReelTextStyleFields
                style={props.draftStyle}
                onChange={props.onStyleChange}
                disabled={props.styleBusy}
              />
            </CollapsibleSection>
            <CollapsibleSection
              title="Hook Lab"
              hint="Generate 9 discovery POV hooks. Accept, delete, or regenerate with notes."
              badge={
                props.hookLabPending.length + props.hookLabAccepted.length > 0
                  ? String(props.hookLabPending.length + props.hookLabAccepted.length)
                  : undefined
              }
              defaultOpen={false}
            >
              <HookLabPanel
                pending={props.hookLabPending}
                accepted={props.hookLabAccepted}
                selected={props.hookLabSelected}
                notes={props.hookLabNotes}
                busy={props.hookLabBusy}
                busyOptionId={props.hookLabBusyOptionId}
                error={props.hookLabError}
                onNotesChange={props.onHookLabNotesChange}
                onGenerate={props.onGenerateHookLab}
                onToggleSelection={props.onToggleHookLabSelection}
                onSelectAll={props.onSelectAllHookLab}
                onClearSelection={props.onClearHookLabSelection}
                onAccept={props.onAcceptHookLabOption}
                onDelete={props.onDeleteHookLabOption}
                onApply={props.onApplyHookLab}
                onCreateVariants={props.onCreateHookLabVariants}
              />
            </CollapsibleSection>
          </div>
          <div className="sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--bg)]">
            <ReelProductionBar
              previewUrl={props.previewUrl}
              downloadUrl={props.downloadUrl}
              renderDisabled={props.renderDisabled}
              renderLabel={props.renderLabel}
              renderIsReRender={props.renderIsReRender}
              draftDiffersFromRendered={props.draftDiffersFromRendered}
              onRender={props.onRender}
              compact
            />
          </div>
        </div>
      ) : (
        <div className="sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--bg)]">
          <ReelProductionBar
            previewUrl={props.previewUrl}
            downloadUrl={props.downloadUrl}
            renderDisabled={props.renderDisabled}
            renderLabel={props.renderLabel}
            renderIsReRender={props.renderIsReRender}
            draftDiffersFromRendered={props.draftDiffersFromRendered}
            onRender={props.onRender}
            compact
          />
        </div>
      )}

      {props.isClipReel && (
        <div className="border-t border-[var(--border)] px-4 pt-3 pb-3 lg:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Render variant
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REEL_VARIANT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={!!props.variantBusy}
                onClick={() => props.onCreateVariant(kind)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                {props.variantBusy === kind ? 'Creating…' : REEL_VARIANT_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function ReelProductionWorkspace(props: ReelProductionWorkspaceProps) {
  if (props.layout === 'workspace') {
    return <WorkspaceLayout {...props} />;
  }
  return <CompactLayout {...props} />;
}
