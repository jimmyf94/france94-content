export const REEL_TEXT_POSITIONS = ['top_third', 'top', 'center'] as const;

export type ReelTextPosition = (typeof REEL_TEXT_POSITIONS)[number];

export type ReelRenderTextStyle = {
  fontsize: number;
  font_color: string;
  outline_width: number;
  outline_color: string;
  position: ReelTextPosition;
  line_spacing: number;
  centered: boolean;
};

export const DEFAULT_REEL_RENDER_TEXT_STYLE: ReelRenderTextStyle = {
  fontsize: 38,
  font_color: 'white',
  outline_width: 4,
  outline_color: 'black',
  position: 'top_third',
  line_spacing: 10,
  centered: true,
};

const FONT_SIZE_MIN = 24;
const FONT_SIZE_MAX = 72;
const OUTLINE_MIN = 0;
const OUTLINE_MAX = 12;
const LINE_SPACING_MIN = 0;
const LINE_SPACING_MAX = 40;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parsePosition(v: unknown): ReelTextPosition | null {
  if (typeof v !== 'string') return null;
  const p = v.trim() as ReelTextPosition;
  return (REEL_TEXT_POSITIONS as readonly string[]).includes(p) ? p : null;
}

function parseColor(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return s.length > 0 ? s : fallback;
}

/** Normalize a color for FFmpeg drawtext filter strings (#hex → 0xRRGGBB). */
export function drawtextColorValue(color: string): string {
  const s = color.trim();
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s);
  if (!hexMatch) return s;
  let hex = hexMatch[1]!;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `0x${hex.toUpperCase()}`;
}

/** Merge workspace defaults, then per-spec overrides, then hardcoded fallbacks. */
export function resolveReelTextStyle(
  specStyle?: Partial<ReelRenderTextStyle> | null,
  workspaceDefaults?: Partial<ReelRenderTextStyle> | null,
): ReelRenderTextStyle {
  const base = { ...DEFAULT_REEL_RENDER_TEXT_STYLE, ...(workspaceDefaults ?? {}) };
  const merged = { ...base, ...(specStyle ?? {}) };
  const position = parsePosition(merged.position) ?? DEFAULT_REEL_RENDER_TEXT_STYLE.position;
  return {
    fontsize: clampInt(merged.fontsize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    font_color: parseColor(merged.font_color, DEFAULT_REEL_RENDER_TEXT_STYLE.font_color),
    outline_width: clampInt(merged.outline_width, OUTLINE_MIN, OUTLINE_MAX),
    outline_color: parseColor(merged.outline_color, DEFAULT_REEL_RENDER_TEXT_STYLE.outline_color),
    position,
    line_spacing: clampInt(merged.line_spacing, LINE_SPACING_MIN, LINE_SPACING_MAX),
    centered: merged.centered !== false,
  };
}

/** FFmpeg drawtext y expression for vertical placement on 9:16 frame. */
export function drawtextYExpression(position: ReelTextPosition): string {
  switch (position) {
    case 'top':
      return 'h*0.08';
    case 'center':
      return '(h-text_h)/2';
    case 'top_third':
    default:
      return '(h/3-text_h)/2';
  }
}

export function drawtextXExpression(centered: boolean): string {
  return centered ? '(w-text_w)/2' : 'w*0.05';
}

function parseOptionalNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Parse partial style from unknown JSON (e.g. reel_instructions.text_style). */
export function parsePartialReelTextStyle(raw: unknown): Partial<ReelRenderTextStyle> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<ReelRenderTextStyle> = {};
  const fontsize = parseOptionalNumber(o.fontsize);
  if (fontsize != null) out.fontsize = fontsize;
  if (typeof o.font_color === 'string') out.font_color = o.font_color;
  const outlineWidth = parseOptionalNumber(o.outline_width);
  if (outlineWidth != null) out.outline_width = outlineWidth;
  if (typeof o.outline_color === 'string') out.outline_color = o.outline_color;
  const pos = parsePosition(o.position);
  if (pos) out.position = pos;
  const lineSpacing = parseOptionalNumber(o.line_spacing);
  if (lineSpacing != null) out.line_spacing = lineSpacing;
  if (typeof o.centered === 'boolean') out.centered = o.centered;
  return Object.keys(out).length > 0 ? out : null;
}

export const REEL_TEXT_STYLE_BOUNDS = {
  fontsize: { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX },
  outline_width: { min: OUTLINE_MIN, max: OUTLINE_MAX },
  line_spacing: { min: LINE_SPACING_MIN, max: LINE_SPACING_MAX },
} as const;

/** 9:16 reel render width — used for overlay word-wrap estimates. */
export const REEL_OVERLAY_FRAME_WIDTH = 1080;

const OVERLAY_HORIZONTAL_MARGIN_RATIO = 0.1;
/** Average glyph width ≈ fontsize × ratio (proportional sans-serif, incl. accents). */
const OVERLAY_AVG_CHAR_WIDTH_RATIO = 0.55;
const OVERLAY_MIN_CHARS_PER_LINE = 14;

/** Word-wrap one overlay line to fit the reel frame at the given font size. */
export function wrapOverlayLine(
  line: string,
  opts: {
    frameWidth?: number;
    fontSize: number;
    horizontalMarginRatio?: number;
    avgCharWidthRatio?: number;
    minCharsPerLine?: number;
  },
): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const frameWidth = opts.frameWidth ?? REEL_OVERLAY_FRAME_WIDTH;
  const margin = opts.horizontalMarginRatio ?? OVERLAY_HORIZONTAL_MARGIN_RATIO;
  const avgCharWidth = opts.fontSize * (opts.avgCharWidthRatio ?? OVERLAY_AVG_CHAR_WIDTH_RATIO);
  const maxWidth = frameWidth * (1 - 2 * margin);
  const maxChars = Math.max(
    opts.minCharsPerLine ?? OVERLAY_MIN_CHARS_PER_LINE,
    Math.floor(maxWidth / avgCharWidth),
  );

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (word.length <= maxChars) {
      current = word;
      continue;
    }
    let rest = word;
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines;
}

/** Wrap stored overlay lines for FFmpeg drawtext (newline-separated physical lines). */
export function wrapOverlayLinesForRender(
  overlayLines: string[],
  style: Pick<ReelRenderTextStyle, 'fontsize'>,
  frameWidth = REEL_OVERLAY_FRAME_WIDTH,
): string {
  return overlayLines
    .slice(0, 3)
    .flatMap((line) =>
      wrapOverlayLine(line, { frameWidth, fontSize: style.fontsize }),
    )
    .join('\n');
}

function normalizeOverlayLineList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Merge hook into overlay_lines when the hook extends the first line (common LLM drift).
 * Drops continuation lines already present in the hook so a two-line hook does not duplicate
 * overlay_lines[1] when it was stored both inside hook and as a separate array entry.
 */
export function mergeHookWithOverlayLines(
  overlayLines: string[] | null | undefined,
  hook: string | null | undefined,
): string[] {
  const lines = normalizeOverlayLineList(overlayLines);
  const hookTrim = hook?.trim() ?? '';
  if (!hookTrim) {
    return dedupeMultilineOverlayFirstLine(lines).slice(0, 3);
  }
  if (lines.length === 0) return [hookTrim].slice(0, 3);

  const first = lines[0]!;
  const hookLines = hookTrim.split('\n').map((l) => l.trim()).filter(Boolean);

  if (hookTrim.length > first.length && hookTrim.startsWith(first)) {
    if (hookLines.length > 1) return hookLines.slice(0, 3);
    const rest = lines.slice(1).filter((l) => {
      const t = l.trim();
      return t && !hookTrim.includes(t);
    });
    return [hookTrim, ...rest].slice(0, 3);
  }

  return dedupeMultilineOverlayFirstLine(lines).slice(0, 3);
}

/** Split overlay_lines[0] when it already contains embedded newlines and drop duplicate tails. */
function dedupeMultilineOverlayFirstLine(lines: string[]): string[] {
  if (lines.length === 0) return [];
  const first = lines[0]!;
  if (!first.includes('\n')) return lines;
  const firstSplit = first.split('\n').map((l) => l.trim()).filter(Boolean);
  const rest = lines.slice(1).filter((l) => {
    const t = l.trim();
    return t && !first.includes(t);
  });
  return [...firstSplit, ...rest];
}

/**
 * Text shown in review UI and written to FFmpeg (newline-separated overlay lines).
 * When hook extends the first overlay line (common LLM drift), prefer the full hook.
 */
export function formatReelOverlayText(
  overlayLines: string[] | null | undefined,
  fallbacks?: { titleOverlay?: string | null; hook?: string | null },
): string {
  const merged = mergeHookWithOverlayLines(overlayLines, fallbacks?.hook);
  if (merged.length > 0) return merged.join('\n');
  return fallbacks?.titleOverlay?.trim() || fallbacks?.hook?.trim() || '';
}

/** Split a textarea draft into overlay_lines for storage (max 3 lines). */
export function parseReelOverlayDraft(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export type ReelTimedOverlayCue = {
  start_sec: number;
  end_sec: number;
  text: string;
};

export const REEL_TIMED_OVERLAY_MAX_CUES = 12;
export const REEL_TIMED_OVERLAY_MAX_TEXT_LEN = 200;

function roundSec(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse timed overlay cues from reel_instructions JSON. */
export function parseTimedOverlayCues(raw: unknown): ReelTimedOverlayCue[] {
  if (!Array.isArray(raw)) return [];
  const out: ReelTimedOverlayCue[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const start = Number(o.start_sec);
    const end = Number(o.end_sec);
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue;
    if (start < 0 || end <= start) continue;
    out.push({
      start_sec: roundSec(start),
      end_sec: roundSec(end),
      text: text.slice(0, REEL_TIMED_OVERLAY_MAX_TEXT_LEN),
    });
  }
  return out.slice(0, REEL_TIMED_OVERLAY_MAX_CUES);
}

/** Clamp, sort, and drop invalid timed overlay cues. */
export function normalizeTimedOverlayCues(
  cues: ReelTimedOverlayCue[],
  opts?: { maxDurationSec?: number },
): ReelTimedOverlayCue[] {
  const maxDur = opts?.maxDurationSec ?? 120;
  return cues
    .filter((c) => c.text.trim() && c.end_sec > c.start_sec && c.start_sec >= 0)
    .map((c) => ({
      start_sec: roundSec(Math.max(0, c.start_sec)),
      end_sec: roundSec(Math.min(maxDur, c.end_sec)),
      text: c.text.trim().slice(0, REEL_TIMED_OVERLAY_MAX_TEXT_LEN),
    }))
    .filter((c) => c.end_sec > c.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec)
    .slice(0, REEL_TIMED_OVERLAY_MAX_CUES);
}

/** Cue active at playback time (half-open interval [start, end)). */
export function activeTimedOverlayCueAtTime(
  cues: ReelTimedOverlayCue[],
  timeSec: number,
): ReelTimedOverlayCue | null {
  if (!Number.isFinite(timeSec)) return null;
  for (const cue of cues) {
    if (timeSec >= cue.start_sec && timeSec < cue.end_sec) return cue;
  }
  return null;
}

/** Parse optional static overlay end from reel_instructions JSON. */
export function parseOverlayEndSec(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundSec(n);
}

/** Clamp static overlay end to reel duration. */
export function normalizeOverlayEndSec(
  value: number | null | undefined,
  maxDurationSec?: number,
): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const maxDur = maxDurationSec ?? 120;
  const clamped = roundSec(Math.min(maxDur, Math.max(0, value)));
  return clamped > 0 ? clamped : null;
}

export type OverlayPreviewResult = {
  text: string | null;
  source: 'cue' | 'static' | null;
};

/** Resolve which overlay text to preview at a given playback time. */
export function resolveOverlayPreviewText(params: {
  overlayLines: string[] | null | undefined;
  overlayEndSec?: number | null;
  timedCues: ReelTimedOverlayCue[];
  timeSec: number;
  fallbacks?: { titleOverlay?: string | null; hook?: string | null };
}): OverlayPreviewResult {
  const { timedCues, timeSec } = params;
  if (!Number.isFinite(timeSec)) return { text: null, source: null };

  const activeCue = activeTimedOverlayCueAtTime(timedCues, timeSec);
  if (activeCue) return { text: activeCue.text, source: 'cue' };

  const staticText = formatReelOverlayText(params.overlayLines, params.fallbacks).trim();
  if (!staticText) return { text: null, source: null };

  const overlayEnd = params.overlayEndSec ?? null;
  const hasTimedCues = timedCues.length > 0;

  if (overlayEnd != null) {
    if (timeSec < overlayEnd) return { text: staticText, source: 'static' };
    return { text: null, source: null };
  }

  if (hasTimedCues) return { text: null, source: null };
  return { text: staticText, source: 'static' };
}

/** Whether a timed cue overlaps the static overlay intro window. */
export function timedCueOverlapsOverlayEnd(
  cues: ReelTimedOverlayCue[],
  overlayEndSec: number | null | undefined,
): boolean {
  if (overlayEndSec == null || overlayEndSec <= 0) return false;
  return cues.some((c) => c.start_sec < overlayEndSec && c.end_sec > 0);
}

/**
 * Build the clips-v1 spec for FFmpeg render. Candidate reel_instructions are the
 * source of truth for overlay text, timed cues, and text_style; job spec only
 * fills in clips when the candidate row is missing them.
 */
export function resolveClipsV1ProductionSpec(
  candidateInstructions: unknown,
  jobSpec: unknown,
): Record<string, unknown> | null {
  const cand =
    candidateInstructions != null &&
    typeof candidateInstructions === 'object' &&
    !Array.isArray(candidateInstructions)
      ? (candidateInstructions as Record<string, unknown>)
      : null;
  const job =
    jobSpec != null && typeof jobSpec === 'object' && !Array.isArray(jobSpec)
      ? (jobSpec as Record<string, unknown>)
      : null;

  if (cand?.version === 'clips-v1') {
    const out: Record<string, unknown> = { ...cand };
    const candClips = Array.isArray(cand.clips) ? cand.clips : [];
    const jobClips = Array.isArray(job?.clips) ? job.clips : [];
    if (candClips.length === 0 && jobClips.length > 0) {
      out.clips = jobClips;
    }
    return out;
  }

  if (job?.version === 'clips-v1') return { ...job };
  return null;
}

export type ReelOverlayProductionFields = {
  overlay_lines?: string[] | null;
  overlay_end_sec?: number | null;
  timed_overlay_cues?: unknown;
  text_style?: Partial<ReelRenderTextStyle> | null;
};

/** Canonical snapshot of overlay fields used for render (for draft vs produced comparison). */
export function reelOverlayProductionSnapshot(params: {
  overlayLines: string[] | string;
  overlayEndSec?: number | null;
  timedCues: ReelTimedOverlayCue[];
  textStyle?: Partial<ReelRenderTextStyle> | null;
  workspaceDefaults?: Partial<ReelRenderTextStyle> | null;
  maxDurationSec?: number;
}): {
  overlay_lines: string[];
  overlay_end_sec: number | null;
  timed_overlay_cues: ReelTimedOverlayCue[];
  text_style: ReelRenderTextStyle;
} {
  const overlay_lines =
    typeof params.overlayLines === 'string'
      ? parseReelOverlayDraft(params.overlayLines)
      : (params.overlayLines ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 3);
  const maxDur = params.maxDurationSec ?? 120;
  return {
    overlay_lines,
    overlay_end_sec: normalizeOverlayEndSec(params.overlayEndSec ?? null, maxDur),
    timed_overlay_cues: normalizeTimedOverlayCues(params.timedCues, { maxDurationSec: maxDur }),
    text_style: resolveReelTextStyle(params.textStyle, params.workspaceDefaults),
  };
}

/** True when draft overlay/style/cues differ from the last produced job spec. */
export function reelOverlayDraftDiffersFromRenderedSpec(params: {
  draftOverlay: string;
  draftOverlayEndSec: number | null;
  draftTimedCues: ReelTimedOverlayCue[];
  draftStyle: ReelRenderTextStyle;
  renderedSpec: ReelOverlayProductionFields | null | undefined;
  workspaceDefaults?: Partial<ReelRenderTextStyle> | null;
  maxDurationSec?: number;
}): boolean {
  if (!params.renderedSpec) return false;
  const maxDur = params.maxDurationSec ?? 120;
  const draft = reelOverlayProductionSnapshot({
    overlayLines: params.draftOverlay,
    overlayEndSec: params.draftOverlayEndSec,
    timedCues: params.draftTimedCues,
    textStyle: params.draftStyle,
    workspaceDefaults: params.workspaceDefaults,
    maxDurationSec: maxDur,
  });
  const rendered = reelOverlayProductionSnapshot({
    overlayLines: params.renderedSpec.overlay_lines ?? [],
    overlayEndSec: parseOverlayEndSec(params.renderedSpec.overlay_end_sec),
    timedCues: parseTimedOverlayCues(params.renderedSpec.timed_overlay_cues),
    textStyle: params.renderedSpec.text_style,
    workspaceDefaults: params.workspaceDefaults,
    maxDurationSec: maxDur,
  });
  return JSON.stringify(draft) !== JSON.stringify(rendered);
}

/** Ensure clips-v1 reel_instructions overlay matches hook when hook is the fuller POV line. */
export function normalizeReelSpecOverlay(
  spec: Record<string, unknown>,
  hook: string | null | undefined,
): Record<string, unknown> {
  if (spec.version !== 'clips-v1') return spec;
  const merged = mergeHookWithOverlayLines(
    spec.overlay_lines as string[] | null | undefined,
    hook,
  );
  const prev = normalizeOverlayLineList(spec.overlay_lines);
  if (merged.length === prev.length && merged.every((l, i) => l === prev[i])) return spec;
  if (merged.length === 0) return spec;
  return { ...spec, overlay_lines: merged };
}
