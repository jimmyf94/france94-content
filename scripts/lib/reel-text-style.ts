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

/** Parse partial style from unknown JSON (e.g. reel_instructions.text_style). */
export function parsePartialReelTextStyle(raw: unknown): Partial<ReelRenderTextStyle> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<ReelRenderTextStyle> = {};
  if (typeof o.fontsize === 'number') out.fontsize = o.fontsize;
  if (typeof o.font_color === 'string') out.font_color = o.font_color;
  if (typeof o.outline_width === 'number') out.outline_width = o.outline_width;
  if (typeof o.outline_color === 'string') out.outline_color = o.outline_color;
  const pos = parsePosition(o.position);
  if (pos) out.position = pos;
  if (typeof o.line_spacing === 'number') out.line_spacing = o.line_spacing;
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
 * Text shown in review UI and written to FFmpeg (newline-separated overlay lines).
 * When hook extends the first overlay line (common LLM drift), prefer the full hook.
 */
export function formatReelOverlayText(
  overlayLines: string[] | null | undefined,
  fallbacks?: { titleOverlay?: string | null; hook?: string | null },
): string {
  const lines = normalizeOverlayLineList(overlayLines);
  const hook = fallbacks?.hook?.trim() ?? '';
  if (lines.length > 0) {
    const joined = lines.join('\n');
    if (hook && hook.length > lines[0]!.length && hook.startsWith(lines[0]!)) {
      return hook;
    }
    return joined;
  }
  return fallbacks?.titleOverlay?.trim() || hook || '';
}

/** Split a textarea draft into overlay_lines for storage (max 3 lines). */
export function parseReelOverlayDraft(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Ensure clips-v1 reel_instructions overlay matches hook when hook is the fuller POV line. */
export function normalizeReelSpecOverlay(
  spec: Record<string, unknown>,
  hook: string | null | undefined,
): Record<string, unknown> {
  if (spec.version !== 'clips-v1') return spec;
  const hookTrim = hook?.trim() ?? '';
  const lines = normalizeOverlayLineList(spec.overlay_lines);
  if (!hookTrim) return spec;
  if (lines.length === 0) {
    return { ...spec, overlay_lines: [hookTrim] };
  }
  if (hookTrim.length > lines[0]!.length && hookTrim.startsWith(lines[0]!)) {
    return {
      ...spec,
      overlay_lines: [hookTrim, ...lines.slice(1).filter((l) => l !== hookTrim)].slice(0, 3),
    };
  }
  return spec;
}
