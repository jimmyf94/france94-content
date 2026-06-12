export const REEL_RENDER_PROGRESS_VERSION = 1;

export const REEL_RENDER_STAGES = [
  'starting',
  'download',
  'encode',
  'concat',
  'thumbnail',
  'upload',
  'done',
] as const;

export type ReelRenderStage = (typeof REEL_RENDER_STAGES)[number];

export type ReelRenderProgressDetail = {
  current: number;
  total: number;
  unit?: string;
};

export type ReelRenderProgress = {
  v: typeof REEL_RENDER_PROGRESS_VERSION;
  stage: ReelRenderStage;
  progress_pct: number;
  message: string;
  started_at: string;
  updated_at: string;
  detail?: ReelRenderProgressDetail;
};

export type ReelRenderProgressPatch = Partial<Omit<ReelRenderProgress, 'v'>> & {
  stage?: ReelRenderStage;
  message?: string;
  progress_pct?: number;
};

export type ParsedRenderProgress = {
  stage: ReelRenderStage | 'queued';
  progressPct: number;
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
  detail: ReelRenderProgressDetail | null;
  etaSeconds: number | null;
  elapsedSeconds: number | null;
  isIndeterminate: boolean;
  showStuckHint: boolean;
};

const STAGE_BANDS: Record<ReelRenderStage, { min: number; max: number }> = {
  starting: { min: 0, max: 5 },
  download: { min: 5, max: 20 },
  encode: { min: 20, max: 75 },
  concat: { min: 75, max: 80 },
  thumbnail: { min: 80, max: 88 },
  upload: { min: 88, max: 99 },
  done: { min: 100, max: 100 },
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function lerpInBand(stage: ReelRenderStage, t: number): number {
  const band = STAGE_BANDS[stage];
  const ratio = Math.min(1, Math.max(0, t));
  return clampPct(band.min + (band.max - band.min) * ratio);
}

export function createRenderProgressPatch(
  partial: ReelRenderProgressPatch & { started_at?: string },
  prev?: ReelRenderProgress | null,
): ReelRenderProgress {
  const startedAt = partial.started_at ?? prev?.started_at ?? nowIso();
  const stage = partial.stage ?? prev?.stage ?? 'starting';
  return {
    v: REEL_RENDER_PROGRESS_VERSION,
    stage,
    progress_pct: clampPct(partial.progress_pct ?? prev?.progress_pct ?? 0),
    message: partial.message ?? prev?.message ?? 'Starting render…',
    started_at: startedAt,
    updated_at: nowIso(),
    detail: partial.detail ?? prev?.detail,
  };
}

export function progressForDownload(assetIndex: number, assetTotal: number): ReelRenderProgressPatch {
  const total = Math.max(1, assetTotal);
  const current = Math.min(Math.max(1, assetIndex), total);
  const t = current / total;
  return {
    stage: 'download',
    progress_pct: lerpInBand('download', t),
    message: `Downloading source ${current} of ${total}…`,
    detail: { current, total, unit: 'source' },
  };
}

export function progressForEncode(segmentIndex: number, segmentTotal: number): ReelRenderProgressPatch {
  const total = Math.max(1, segmentTotal);
  const current = Math.min(Math.max(1, segmentIndex), total);
  const t = current / total;
  return {
    stage: 'encode',
    progress_pct: lerpInBand('encode', t),
    message: `Encoding clip ${current} of ${total}…`,
    detail: { current, total, unit: 'clip' },
  };
}

export function progressForStage(
  stage: Extract<ReelRenderStage, 'concat' | 'thumbnail' | 'upload' | 'starting' | 'done'>,
  message?: string,
): ReelRenderProgressPatch {
  const defaults: Record<typeof stage, string> = {
    starting: 'Starting render…',
    concat: 'Joining clips…',
    thumbnail: 'Extracting thumbnail…',
    upload: 'Uploading rendered video…',
    done: 'Render complete',
  };
  return {
    stage,
    progress_pct: STAGE_BANDS[stage].max,
    message: message ?? defaults[stage],
  };
}

export function estimateRemainingSeconds(
  startedAt: string | null | undefined,
  progressPct: number,
  nowMs = Date.now(),
): number | null {
  if (!startedAt || progressPct < 5) return null;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return null;
  const elapsedSec = Math.max(0, (nowMs - startedMs) / 1000);
  if (elapsedSec <= 0) return null;
  return Math.round((elapsedSec * (100 - progressPct)) / progressPct);
}

export function formatDurationShort(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const sec = Math.round(totalSeconds);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function formatElapsed(startedAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!startedAt) return null;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return null;
  return formatDurationShort(Math.max(0, (nowMs - startedMs) / 1000));
}

function isReelRenderStage(v: unknown): v is ReelRenderStage {
  return typeof v === 'string' && (REEL_RENDER_STAGES as readonly string[]).includes(v);
}

export function parseRenderProgressLog(raw: unknown): ReelRenderProgress | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== REEL_RENDER_PROGRESS_VERSION) return null;
  if (!isReelRenderStage(o.stage)) return null;
  if (typeof o.message !== 'string' || typeof o.started_at !== 'string') return null;
  const detailRaw = o.detail;
  let detail: ReelRenderProgressDetail | undefined;
  if (detailRaw != null && typeof detailRaw === 'object' && !Array.isArray(detailRaw)) {
    const d = detailRaw as Record<string, unknown>;
    if (typeof d.current === 'number' && typeof d.total === 'number') {
      detail = {
        current: d.current,
        total: d.total,
        unit: typeof d.unit === 'string' ? d.unit : undefined,
      };
    }
  }
  return {
    v: REEL_RENDER_PROGRESS_VERSION,
    stage: o.stage,
    progress_pct: clampPct(Number(o.progress_pct)),
    message: o.message,
    started_at: o.started_at,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : o.started_at,
    detail,
  };
}

export function parseRenderProgress(
  renderLog: unknown,
  jobStatus: string | null | undefined,
  jobUpdatedAt?: string | null,
): ParsedRenderProgress {
  const parsed = parseRenderProgressLog(renderLog);
  const status = (jobStatus ?? '').trim();
  const updatedAt = parsed?.updated_at ?? jobUpdatedAt ?? null;
  const startedAt = parsed?.started_at ?? null;

  if (parsed) {
    const etaSeconds = estimateRemainingSeconds(startedAt, parsed.progress_pct);
    return {
      stage: parsed.stage,
      progressPct: parsed.progress_pct,
      message: parsed.message,
      startedAt,
      updatedAt,
      detail: parsed.detail ?? null,
      etaSeconds,
      elapsedSeconds:
        startedAt && Number.isFinite(Date.parse(startedAt))
          ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000))
          : null,
      isIndeterminate: status === 'queued' && parsed.progress_pct < 5,
      showStuckHint: status === 'queued' && isStale(updatedAt, 20_000),
    };
  }

  const fallbackMessage =
    status === 'rendering' ? 'Rendering video…' : status === 'queued' ? 'Waiting for render worker…' : '';

  return {
    stage: status === 'queued' ? 'queued' : 'starting',
    progressPct: status === 'rendering' ? 5 : 0,
    message: fallbackMessage,
    startedAt: null,
    updatedAt,
    detail: null,
    etaSeconds: null,
    elapsedSeconds: null,
    isIndeterminate: status === 'queued',
    showStuckHint: status === 'queued' && isStale(updatedAt ?? jobUpdatedAt, 20_000),
  };
}

function isStale(iso: string | null | undefined, thresholdMs: number): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms > thresholdMs;
}

/** Merge render progress fields into a technical render_log object (e.g. duration_seconds). */
export function mergeRenderLogWithProgress(
  progress: ReelRenderProgress,
  technical?: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...(technical ?? {}), ...progress };
}
