'use client';

import { useState } from 'react';

import type { ReelRenderTextStyle } from '@fr94/reel-text-style';

import { MainMediaPreview } from './MainMediaPreview';
import { ReelRenderProgress } from './ReelRenderProgress';
import { ReelTextStyleFields } from './ReelTextStyleFields';
import { ReviewMediaTrashButton } from './ReviewMediaTrashButton';
import type { PostCandidate, ReelVariantKind, ReviewDriveFile } from './types';
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
  draftStyle: ReelRenderTextStyle;
  styleBusy: boolean;
  variantBusy: ReelVariantKind | null;
  onOverlayChange: (v: string) => void;
  onStyleChange: (s: ReelRenderTextStyle) => void;
  onCreateVariant: (kind: ReelVariantKind) => void;
  media?: CandidateMediaState;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onRegisterActivateStream?: (activate: () => void) => void;
  onRemoveReviewAsset?: (file: ReviewDriveFile) => void;
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
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
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
        <span className="shrink-0 rounded-sm border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
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

function ReelProductionBar({
  previewUrl,
  downloadUrl,
  renderDisabled,
  renderLabel,
  renderIsReRender = false,
  onRender,
  compact = false,
}: {
  previewUrl: string | null;
  downloadUrl: string | null;
  renderDisabled: boolean;
  renderLabel: string;
  renderIsReRender?: boolean;
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
  hookText,
  large,
  candidate,
  media,
  isRenderActive = false,
}: {
  previewUrl: string | null;
  posterUrl: string | null;
  hookText: string | null;
  large?: boolean;
  candidate?: PostCandidate;
  media?: CandidateMediaState;
  isRenderActive?: boolean;
}) {
  const shellClass = large
    ? 'flex h-full min-h-0 w-full items-center justify-center'
    : 'flex w-full items-center justify-center';
  const videoClass = large
    ? 'h-full max-h-full w-auto max-w-full rounded-xl border border-[var(--border)] bg-black object-contain shadow-lg'
    : 'max-h-80 w-full max-w-sm rounded-md border border-[var(--border)] bg-black';
  const frameClass = large
    ? 'flex h-full max-h-full w-auto max-w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg'
    : 'w-full max-w-sm overflow-hidden rounded-md border border-[var(--border)] bg-black';

  const firstSourceFile = media?.files?.[0] ?? null;
  const showSourceFallback = !previewUrl && !posterUrl && firstSourceFile && candidate;

  return (
    <div className={shellClass}>
      <div
        className={
          large
            ? 'flex h-full max-h-full flex-col items-center justify-center gap-3'
            : 'w-full'
        }
      >
        {previewUrl ? (
          <video
            key={previewUrl}
            src={previewUrl}
            poster={posterUrl ?? undefined}
            controls
            playsInline
            className={videoClass}
            style={large ? { aspectRatio: '9 / 16' } : undefined}
          />
        ) : posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={posterUrl}
            src={posterUrl}
            alt="Reel thumbnail"
            className={
              large
                ? 'h-full max-h-full w-auto max-w-full rounded-xl border border-[var(--border)] object-cover shadow-lg'
                : 'max-h-48 w-full max-w-sm rounded-md border border-[var(--border)] object-cover'
            }
            style={large ? { aspectRatio: '9 / 16' } : undefined}
          />
        ) : showSourceFallback ? (
          <div
            className={`flex flex-col items-center gap-3 ${large ? 'h-full max-h-full' : 'w-full'}`}
          >
            <div
              className={frameClass}
              style={large ? { aspectRatio: '9 / 16', maxHeight: '100%' } : undefined}
            >
              <MainMediaPreview
                file={firstSourceFile}
                candidateId={candidate.id}
                compact={!large}
              />
            </div>
            <p className="text-xs text-[var(--muted)]">Source preview — not the final render</p>
          </div>
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
            <p className="mt-1 text-xs text-[var(--muted)]">Use Render in the panel to create the final MP4</p>
            {hookText && (
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--muted)]">{hookText}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceClipsPanel({
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
  const canDetachSource = (candidate.source_asset_ids?.length ?? 0) > 0;

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading source clips…</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--bad)]">{error}</p>;
  }
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-[var(--muted)]">
        <p>No media in review folder.</p>
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
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {files.map((f, i) => (
        <div
          key={f.id}
          className="relative flex min-h-[200px] shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-black/40 p-2"
        >
          {onRemoveReviewAsset && canDetachSource && (
            <ReviewMediaTrashButton file={f} onRemove={onRemoveReviewAsset} />
          )}
          <MainMediaPreview
            file={f}
            candidateId={candidate.id}
            videoRef={i === firstVideoIdx ? videoRef : undefined}
            onRegisterActivateStream={i === firstVideoIdx ? onRegisterActivateStream : undefined}
            compact={files.length > 1}
          />
        </div>
      ))}
    </div>
  );
}

function OperatorPanel({
  isClipReel,
  draftOverlay,
  draftStyle,
  styleBusy,
  variantBusy,
  onOverlayChange,
  onStyleChange,
  onCreateVariant,
  clips,
  reasoningEntries,
}: Pick<
  ReelProductionWorkspaceProps,
  | 'isClipReel'
  | 'draftOverlay'
  | 'draftStyle'
  | 'styleBusy'
  | 'variantBusy'
  | 'onOverlayChange'
  | 'onStyleChange'
  | 'onCreateVariant'
  | 'clips'
  | 'reasoningEntries'
>) {
  return (
    <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      {isClipReel && (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Overlay text
          </h3>
          <textarea
            value={draftOverlay}
            disabled={styleBusy}
            onChange={(e) => onOverlayChange(e.target.value)}
            rows={4}
            placeholder="On-screen text for the reel…"
            className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base leading-relaxed text-[var(--text)] placeholder:text-[var(--muted)] disabled:opacity-50"
          />
          <ReelTextStyleFields style={draftStyle} onChange={onStyleChange} disabled={styleBusy} />
        </section>
      )}

      {isClipReel && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Variants
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Reuses pre-tagged clips. Creates a new candidate and queues a render.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
        </section>
      )}

      {clips && clips.length > 0 && (
        <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Clips ({clips.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text)]">
            {clips.map((c, i) => (
              <li key={c.clip_id ?? i} className="leading-relaxed">
                <span className="font-medium text-[var(--muted)]">#{i + 1}</span>{' '}
                {(c.end_sec - c.start_sec).toFixed(1)}s
                {c.why ? <span className="text-[var(--muted)]"> — {c.why}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}

      {reasoningEntries.length > 0 && (
        <details className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Assembly reasoning
          </summary>
          <dl className="mt-3 space-y-3 text-sm">
            {reasoningEntries.map(([label, text]) => (
              <div key={label}>
                <dt className="font-medium text-[var(--text)]">{label}</dt>
                <dd className="mt-0.5 leading-relaxed text-[var(--muted)]">{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function WorkspaceLayout(props: ReelProductionWorkspaceProps) {
  const [stageTab, setStageTab] = useState<StageTab>('rendered');
  const laneTag = resolveLaneTag(props.candidate);
  const assetCount = props.media?.files?.length ?? props.clipCount;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg)]">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-h-0 flex-col border-r border-[var(--border)]">
          <div className="relative flex shrink-0 items-center justify-center border-b border-[var(--border)] bg-[var(--surface)] px-4">
            <div className="flex min-w-0">
              <button
                type="button"
                onClick={() => setStageTab('rendered')}
                className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  stageTab === 'rendered'
                    ? 'border-[var(--accent)] text-[var(--text)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Rendered
              </button>
              <button
                type="button"
                onClick={() => setStageTab('source')}
                className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  stageTab === 'source'
                    ? 'border-[var(--accent)] text-[var(--text)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Source clips
              </button>
            </div>
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <ReelPreviewStats
                durationSec={props.durationSec}
                assetCount={assetCount}
                laneTag={laneTag}
                status={props.job?.status ?? null}
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {stageTab === 'rendered' ? (
              <RenderedStage
                previewUrl={props.previewUrl}
                posterUrl={props.posterUrl}
                hookText={props.hookText}
                large
                candidate={props.candidate}
                media={props.media}
              />
            ) : props.media ? (
              <SourceClipsPanel
                candidate={props.candidate}
                media={props.media}
                videoRef={props.videoRef}
                onRegisterActivateStream={props.onRegisterActivateStream}
                onRemoveReviewAsset={props.onRemoveReviewAsset}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">Source clips unavailable</p>
            )}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
          <ReelProductionBar
            previewUrl={props.previewUrl}
            downloadUrl={props.downloadUrl}
            renderDisabled={props.renderDisabled}
            renderLabel={props.renderLabel}
            renderIsReRender={props.renderIsReRender}
            onRender={props.onRender}
          />
          {(props.loading && !props.job) || props.error || props.job?.error_message ? (
            <div className="shrink-0 border-b border-[var(--border)] px-3 py-2">
              {props.loading && !props.job && (
                <p className="text-xs text-[var(--muted)]">Loading render job…</p>
              )}
              {props.error && (
                <p className="text-xs whitespace-pre-wrap text-[var(--bad)]">{props.error}</p>
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
          <div className="min-h-0 flex-1 overflow-hidden p-4">
            <OperatorPanel
              isClipReel={props.isClipReel}
              draftOverlay={props.draftOverlay}
              draftStyle={props.draftStyle}
              styleBusy={props.styleBusy}
              variantBusy={props.variantBusy}
              onOverlayChange={props.onOverlayChange}
              onStyleChange={props.onStyleChange}
              onCreateVariant={props.onCreateVariant}
              clips={props.clips}
              reasoningEntries={props.reasoningEntries}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function CompactLayout(props: ReelProductionWorkspaceProps) {
  const [styleOpen, setStyleOpen] = useState(false);
  const laneTag = resolveLaneTag(props.candidate);
  const assetCount = props.media?.files?.length ?? props.clipCount;

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
      {(props.loading && !props.job) || props.error ? (
        <div className="border-b border-[var(--border)] px-4 py-2 lg:px-6">
          {props.loading && !props.job && (
            <p className="text-xs text-[var(--muted)]">Loading render job…</p>
          )}
          {props.error && (
            <p className="text-xs whitespace-pre-wrap text-[var(--bad)]">{props.error}</p>
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
        <RenderedStage
          previewUrl={props.previewUrl}
          posterUrl={props.posterUrl}
          hookText={props.hookText}
          candidate={props.candidate}
          media={props.media}
          isRenderActive={props.isRenderActive}
        />
      </div>

      {props.isClipReel ? (
        <div className="border-t border-[var(--border)]">
          <div className="px-4 pt-3 pb-3 lg:px-6">
            <details
              open={styleOpen}
              onToggle={(e) => setStyleOpen((e.target as HTMLDetailsElement).open)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2"
            >
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Text style
              </summary>
              <div className="mt-3 space-y-3">
                <label className="block text-xs">
                  <span className="text-[var(--muted)]">Overlay line(s)</span>
                  <textarea
                    value={props.draftOverlay}
                    disabled={props.styleBusy}
                    onChange={(e) => props.onOverlayChange(e.target.value)}
                    rows={3}
                    className="mt-1 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
                  />
                </label>
                <ReelTextStyleFields
                  style={props.draftStyle}
                  onChange={props.onStyleChange}
                  disabled={props.styleBusy}
                />
              </div>
            </details>
          </div>
          <div className="sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--bg)]">
            <ReelProductionBar
              previewUrl={props.previewUrl}
              downloadUrl={props.downloadUrl}
              renderDisabled={props.renderDisabled}
              renderLabel={props.renderLabel}
              renderIsReRender={props.renderIsReRender}
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
