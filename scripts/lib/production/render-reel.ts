import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import ffmpegPathDefault from 'ffmpeg-static';

import {
  drawtextColorValue,
  drawtextXExpression,
  drawtextYExpression,
  parseOverlayEndSec,
  parsePartialReelTextStyle,
  parseTimedOverlayCues,
  resolveReelTextStyle,
  wrapOverlayLine,
  wrapOverlayLinesForRender,
  type ReelRenderTextStyle,
  type ReelTimedOverlayCue,
} from '../reel-text-style.js';
import type { ReelRenderProgressPatch } from '../reel-render-progress.js';
import { progressForEncode, progressForStage } from '../reel-render-progress.js';
import { probeVideo, withTempDir } from '../video-preprocess.js';

const OUTRO_DEFAULT_LINES = ['94 triathlons · 94 jours · 94 départements'];
const MAX_SOURCES = 3;
const MAX_SEGMENT_SEC = 15;
const MAX_TOTAL_SEC = 60;
const TARGET_W = 1080;
const TARGET_H = 1920;
const AUDIO_RATE = 48000;

const FFMPEG_STATIC_PATH =
  typeof ffmpegPathDefault === 'string' ? ffmpegPathDefault : null;

function ffmpegCandidatePaths(needsDrawtext: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [
    process.env.FFMPEG_PATH,
    '/usr/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    ...(needsDrawtext ? [] : [FFMPEG_STATIC_PATH]),
  ]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function hasDrawtextFilter(bin: string): boolean {
  try {
    if (!fs.existsSync(bin)) return false;
    const result = spawnSync(bin, ['-h', 'filter=drawtext'], { encoding: 'utf8' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status !== 0) return false;
    return /drawtext/i.test(output) && !/Unknown filter/i.test(output);
  } catch {
    return false;
  }
}

function resolveFfmpegBin(needsDrawtext: boolean): { bin: string; drawtextAvailable: boolean } {
  const candidates = ffmpegCandidatePaths(needsDrawtext);
  if (needsDrawtext) {
    for (const bin of candidates) {
      if (hasDrawtextFilter(bin)) {
        return { bin, drawtextAvailable: true };
      }
    }
    throw new Error(
      'Reel overlay text requires ffmpeg with the drawtext filter. ' +
        'Install ffmpeg (e.g. brew install ffmpeg or apt install ffmpeg) and set FFMPEG_PATH, ' +
        'or use a build compiled with libfreetype/libfontconfig.',
    );
  }

  for (const bin of candidates) {
    if (fs.existsSync(bin)) {
      return { bin, drawtextAvailable: hasDrawtextFilter(bin) };
    }
  }
  throw new Error('ffmpeg binary not found (ffmpeg-static).');
}

function pickFontFile(): string | null {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) return f;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function runFfmpeg(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
    });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else {
        const tail = stderr.trim().split('\n').slice(-8).join('\n');
        reject(new Error(`ffmpeg exited ${code}: ${tail}`));
      }
    });
  });
}

type SegmentSpec = {
  /** Index into sourceVideos. */
  sourceIndex: number;
  startSec: number;
  endSec: number | null;
};

type ParsedInstructions = {
  segments: SegmentSpec[] | null;
  overlayLines: string[];
  overlayEndSec: number | null;
  timedOverlayCues: ReelTimedOverlayCue[];
  includeOutro: boolean;
  /** Overlay persists for the whole reel (clips-v1) vs first 3s (legacy). */
  persistentOverlay: boolean;
  textStylePartial: Partial<ReelRenderTextStyle> | null;
};

/**
 * Supports two shapes:
 * - clips-v1 (reel_specification from clip-based assembly): clips reference
 *   asset_id + start_sec/end_sec; mapped to source buffers via sourceAssetIds.
 * - legacy: clips are positional {start,end} per source; overlay_text/structure.
 */
function parseInstructions(raw: unknown, sourceAssetIds: string[]): ParsedInstructions {
  const overlayLines: string[] = [];
  let overlayEndSec: number | null = null;
  let timedOverlayCues: ReelTimedOverlayCue[] = [];
  let includeOutro = true;
  let persistentOverlay = false;
  let segments: SegmentSpec[] | null = null;
  let textStylePartial: Partial<ReelRenderTextStyle> | null = null;

  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;

    if (o.version === 'clips-v1' && Array.isArray(o.clips)) {
      segments = [];
      for (const x of o.clips) {
        if (x == null || typeof x !== 'object') continue;
        const row = x as Record<string, unknown>;
        const assetId = typeof row.asset_id === 'string' ? row.asset_id : '';
        const sourceIndex = sourceAssetIds.indexOf(assetId);
        if (sourceIndex === -1) continue;
        const start = Number(row.start_sec);
        const end = Number(row.end_sec);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        segments.push({ sourceIndex, startSec: Math.max(0, start), endSec: end });
      }
      timedOverlayCues = parseTimedOverlayCues(o.timed_overlay_cues);
      overlayEndSec = parseOverlayEndSec(o.overlay_end_sec);
      const ol = o.overlay_lines;
      if (Array.isArray(ol)) {
        for (const t of ol) {
          if (typeof t === 'string' && t.trim()) overlayLines.push(t.trim());
        }
      }
      includeOutro = false;
      persistentOverlay = timedOverlayCues.length === 0 && overlayEndSec == null;
      textStylePartial = parsePartialReelTextStyle(o.text_style);
      return {
        segments,
        overlayLines,
        overlayEndSec,
        timedOverlayCues,
        includeOutro,
        persistentOverlay,
        textStylePartial,
      };
    }

    const c = o.clips;
    if (Array.isArray(c)) {
      segments = [];
      let i = 0;
      for (const x of c) {
        if (x == null || typeof x !== 'object') continue;
        const row = x as Record<string, unknown>;
        const start = typeof row.start === 'number' ? row.start : Number(row.start);
        const end = typeof row.end === 'number' ? row.end : Number(row.end);
        const startSec = Number.isFinite(start) && start >= 0 ? start : 0;
        const endSec = Number.isFinite(end) && end > startSec ? end : null;
        segments.push({ sourceIndex: i, startSec, endSec });
        i += 1;
      }
    }

    const ot = o.overlay_text;
    if (Array.isArray(ot)) {
      for (const t of ot) {
        if (typeof t === 'string' && t.trim()) overlayLines.push(t.trim());
      }
    }

    const st = o.structure;
    if (Array.isArray(st)) {
      for (const row of st) {
        if (row == null || typeof row !== 'object') continue;
        const ins = (row as Record<string, unknown>).instruction;
        if (typeof ins === 'string' && ins.trim()) overlayLines.push(ins.trim());
      }
    }

    if (o.outro_card === false) includeOutro = false;
  }

  return {
    segments,
    overlayLines,
    overlayEndSec,
    timedOverlayCues,
    includeOutro,
    persistentOverlay,
    textStylePartial,
  };
}

function scaleCropFilter(): string {
  return `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},setsar=1`;
}

function escapeDrawtextPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function overlayFilter(params: {
  font: string;
  textFileAbs: string;
  persistent: boolean;
  style: ReelRenderTextStyle;
  enableStartSec?: number;
  enableEndSec?: number;
}): string {
  let enable = '';
  if (params.enableStartSec != null && params.enableEndSec != null) {
    enable = `:enable='between(t,${params.enableStartSec},${params.enableEndSec})'`;
  } else if (!params.persistent) {
    enable = `:enable='between(t,0,3)'`;
  }
  const { style } = params;
  const border =
    style.outline_width > 0
      ? `:borderw=${style.outline_width}:bordercolor=${drawtextColorValue(style.outline_color)}`
      : '';
  return (
    `,drawtext=fontfile='${escapeDrawtextPath(params.font)}'` +
    `:textfile='${escapeDrawtextPath(params.textFileAbs)}':reload=1` +
    `:fontsize=${style.fontsize}:fontcolor=${drawtextColorValue(style.font_color)}${border}` +
    `:x=${drawtextXExpression(style.centered)}:y=${drawtextYExpression(style.position)}` +
    `:line_spacing=${style.line_spacing}${enable}`
  );
}

type SegmentRenderPlan = {
  seg: SegmentSpec;
  segLen: number;
  globalStart: number;
  globalEnd: number;
};

type LocalTimedCue = {
  startSec: number;
  endSec: number;
  text: string;
};

function resolveSegmentLength(
  seg: SegmentSpec,
  probe: Awaited<ReturnType<typeof probeVideo>>,
  remainingBudget: number,
): number {
  const dur = probe.durationSeconds ?? 0;
  let start = Math.max(0, seg.startSec);
  let end = seg.endSec != null && seg.endSec > start ? seg.endSec : null;
  if (dur > 0) {
    start = Math.min(start, Math.max(0, dur - 0.05));
    if (end != null) end = Math.min(end, dur);
  }
  let segLen =
    end != null ? end - start : dur > 0 ? Math.min(MAX_SEGMENT_SEC, dur - start) : MAX_SEGMENT_SEC;
  if (!Number.isFinite(segLen) || segLen <= 0) segLen = Math.min(MAX_SEGMENT_SEC, dur || MAX_SEGMENT_SEC);
  if (remainingBudget > 0 && segLen > remainingBudget) {
    segLen = Math.max(0.1, remainingBudget);
  }
  return segLen;
}

function buildSegmentPlans(
  segments: SegmentSpec[],
  srcProbes: Array<Awaited<ReturnType<typeof probeVideo>>>,
): SegmentRenderPlan[] {
  const plans: SegmentRenderPlan[] = [];
  let globalStart = 0;
  let remaining = MAX_TOTAL_SEC;

  for (const seg of segments) {
    const probe = srcProbes[seg.sourceIndex];
    if (!probe) continue;
    const segLen = resolveSegmentLength(seg, probe, remaining);
    if (segLen <= 0 || remaining <= 0) break;
    plans.push({
      seg,
      segLen,
      globalStart,
      globalEnd: globalStart + segLen,
    });
    globalStart += segLen;
    remaining -= segLen;
    if (remaining <= 0) break;
  }
  return plans;
}

function mapTimedCuesToSegment(
  cues: ReelTimedOverlayCue[],
  globalStart: number,
  globalEnd: number,
): LocalTimedCue[] {
  const local: LocalTimedCue[] = [];
  for (const cue of cues) {
    if (cue.end_sec <= globalStart || cue.start_sec >= globalEnd) continue;
    const startSec = Math.max(0, cue.start_sec - globalStart);
    const endSec = Math.min(globalEnd - globalStart, cue.end_sec - globalStart);
    if (endSec <= startSec) continue;
    local.push({
      startSec: +startSec.toFixed(3),
      endSec: +endSec.toFixed(3),
      text: cue.text,
    });
  }
  return local;
}

function mapGlobalWindowToSegment(
  windowStart: number,
  windowEnd: number,
  globalStart: number,
  globalEnd: number,
): { startSec: number; endSec: number } | null {
  if (windowEnd <= globalStart || windowStart >= globalEnd) return null;
  const startSec = Math.max(0, windowStart - globalStart);
  const endSec = Math.min(globalEnd - globalStart, windowEnd - globalStart);
  if (endSec <= startSec) return null;
  return {
    startSec: +startSec.toFixed(3),
    endSec: +endSec.toFixed(3),
  };
}

function wrapCueTextForRender(text: string, style: ReelRenderTextStyle): string {
  return wrapOverlayLine(text, { fontSize: style.fontsize }).join('\n');
}

const AUDIO_ENC = ['-c:a', 'aac', '-b:a', '128k', '-ar', String(AUDIO_RATE), '-ac', '2'];

/**
 * Deterministic 9:16 reel draft: trim → H.264 1080×1920 + AAC (original audio,
 * silent track when source has none) → top-third outlined text → faststart MP4.
 */
export async function renderReel(params: {
  sourceVideos: Buffer[];
  instructions: unknown;
  /** content_asset ids aligned with sourceVideos; required to map clips-v1 specs. */
  sourceAssetIds?: string[];
  /** Workspace defaults when spec has no text_style overrides. */
  defaultTextStyle?: ReelRenderTextStyle;
  onProgress?: (patch: ReelRenderProgressPatch) => void;
}): Promise<{
  mp4: Buffer;
  thumbnailJpeg: Buffer | null;
  durationSec: number | null;
  log: Record<string, unknown>;
}> {
  const buffers = params.sourceVideos.slice(0, MAX_SOURCES);
  if (buffers.length === 0) {
    throw new Error('renderReel: no source videos');
  }

  const sourceAssetIds = (params.sourceAssetIds ?? []).slice(0, MAX_SOURCES);
  const parsed = parseInstructions(params.instructions, sourceAssetIds);
  const { overlayLines, overlayEndSec, timedOverlayCues, includeOutro, persistentOverlay } = parsed;
  const textStyle = resolveReelTextStyle(parsed.textStylePartial, params.defaultTextStyle);
  const useTimedOverlay = timedOverlayCues.length > 0;
  const shouldRenderStatic =
    overlayLines.length > 0 && (timedOverlayCues.length === 0 || overlayEndSec != null);
  const staticOverlayPersistent = shouldRenderStatic && persistentOverlay;

  let segments: SegmentSpec[];
  if (parsed.segments != null && parsed.segments.length > 0) {
    segments = parsed.segments.slice(0, MAX_SOURCES);
  } else {
    segments = buffers.map((_, i) => ({ sourceIndex: i, startSec: 0, endSec: null }));
  }

  const font = pickFontFile();
  const needsDrawtext = Boolean(
    font && (useTimedOverlay || shouldRenderStatic || includeOutro),
  );
  const { bin: ffmpegPath, drawtextAvailable } = resolveFfmpegBin(needsDrawtext);
  const log: Record<string, unknown> = {
    target: `${TARGET_W}x${TARGET_H}`,
    segments: segments.length,
    font: font ?? 'none',
    overlay_lines: overlayLines.length,
    overlay_end_sec: overlayEndSec,
    timed_overlay_cues: timedOverlayCues.length,
    include_outro: includeOutro,
    keep_audio: true,
    text_style: textStyle,
    ffmpeg_path: ffmpegPath,
    drawtext_available: drawtextAvailable,
    static_overlay_mode: staticOverlayPersistent
      ? 'persistent_whole_reel'
      : shouldRenderStatic && overlayEndSec != null
        ? 'windowed_intro'
        : shouldRenderStatic
          ? 'active_without_end'
          : 'skipped',
    timed_overlay_cue_windows: timedOverlayCues.map((c) => ({
      start_sec: c.start_sec,
      end_sec: c.end_sec,
      text_preview: c.text.slice(0, 48),
    })),
  };

  return withTempDir('fr94-reel-', async (dir) => {
    // Write each unique source once.
    const srcPaths: string[] = [];
    const srcProbes: Array<Awaited<ReturnType<typeof probeVideo>>> = [];
    for (let i = 0; i < buffers.length; i++) {
      const inPath = path.join(dir, `src_${i}.bin`);
      fs.writeFileSync(inPath, buffers[i]!);
      srcPaths.push(inPath);
      srcProbes.push(await probeVideo(inPath));
    }

    const segmentPlans = buildSegmentPlans(segments, srcProbes);
    if (segmentPlans.length === 0) {
      throw new Error('No segments produced (duration / trim invalid).');
    }

    const staticOverlayTextAbs = path.join(dir, 'overlay.txt');
    let staticOverlayPersistentFilter = '';
    if (staticOverlayPersistent && font) {
      const wrapped = wrapOverlayLinesForRender(overlayLines.slice(0, 3), textStyle);
      fs.writeFileSync(staticOverlayTextAbs, wrapped, 'utf8');
      log.overlay_wrapped_lines = wrapped.split('\n').length;
      staticOverlayPersistentFilter = overlayFilter({
        font,
        textFileAbs: staticOverlayTextAbs,
        persistent: true,
        style: textStyle,
      });
    } else if (shouldRenderStatic && overlayEndSec != null && font) {
      const wrapped = wrapOverlayLinesForRender(overlayLines.slice(0, 3), textStyle);
      fs.writeFileSync(staticOverlayTextAbs, wrapped, 'utf8');
      log.overlay_wrapped_lines = wrapped.split('\n').length;
    }

    const segmentPaths: string[] = [];
    const stderrTails: string[] = [];
    const segmentTotal = segmentPlans.length;
    const segmentOverlayLog: Array<{
      segment_index: number;
      global_start: number;
      global_end: number;
      static_window: { start_sec: number; end_sec: number } | null;
      timed_cues: Array<{ start_sec: number; end_sec: number; text_preview: string }>;
    }> = [];

    for (let i = 0; i < segmentPlans.length; i++) {
      const plan = segmentPlans[i]!;
      const seg = plan.seg;
      const inPath = srcPaths[seg.sourceIndex];
      const probe = srcProbes[seg.sourceIndex];
      if (!inPath || !probe) continue;

      const dur = probe.durationSeconds ?? 0;
      let start = Math.max(0, seg.startSec);
      let end = seg.endSec != null && seg.endSec > start ? seg.endSec : null;
      if (dur > 0) {
        start = Math.min(start, Math.max(0, dur - 0.05));
        if (end != null) end = Math.min(end, dur);
      }
      const segLen = plan.segLen;

      let staticOverlay = staticOverlayPersistentFilter;
      let staticWindowLog: { start_sec: number; end_sec: number } | null = null;
      if (
        shouldRenderStatic &&
        overlayEndSec != null &&
        font &&
        !staticOverlayPersistent
      ) {
        const localWindow = mapGlobalWindowToSegment(
          0,
          overlayEndSec,
          plan.globalStart,
          plan.globalEnd,
        );
        if (localWindow) {
          staticWindowLog = {
            start_sec: localWindow.startSec,
            end_sec: localWindow.endSec,
          };
          staticOverlay = overlayFilter({
            font,
            textFileAbs: staticOverlayTextAbs,
            persistent: false,
            style: textStyle,
            enableStartSec: localWindow.startSec,
            enableEndSec: localWindow.endSec,
          });
        }
      } else if (staticOverlayPersistent) {
        staticWindowLog = { start_sec: 0, end_sec: +plan.segLen.toFixed(3) };
      }

      let timedOverlay = '';
      const timedCueLog: Array<{ start_sec: number; end_sec: number; text_preview: string }> = [];
      if (useTimedOverlay && font) {
        const localCues = mapTimedCuesToSegment(
          timedOverlayCues,
          plan.globalStart,
          plan.globalEnd,
        );
        for (let j = 0; j < localCues.length; j++) {
          const cue = localCues[j]!;
          timedCueLog.push({
            start_sec: cue.startSec,
            end_sec: cue.endSec,
            text_preview: cue.text.slice(0, 48),
          });
          const textAbs = path.join(dir, `cue_${i}_${j}.txt`);
          fs.writeFileSync(textAbs, wrapCueTextForRender(cue.text, textStyle), 'utf8');
          timedOverlay += overlayFilter({
            font,
            textFileAbs: textAbs,
            persistent: false,
            style: textStyle,
            enableStartSec: cue.startSec,
            enableEndSec: cue.endSec,
          });
        }
      }

      segmentOverlayLog.push({
        segment_index: i,
        global_start: +plan.globalStart.toFixed(3),
        global_end: +plan.globalEnd.toFixed(3),
        static_window: staticWindowLog,
        timed_cues: timedCueLog,
      });

      const segOut = path.join(dir, `seg_${i}.mp4`);
      const vf = scaleCropFilter() + staticOverlay + timedOverlay;
      const hasAudio = probe.hasAudio;

      const args = ['-y', '-loglevel', 'error', '-ss', String(start), '-i', inPath];
      if (!hasAudio) {
        args.push(
          '-f',
          'lavfi',
          '-i',
          `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
        );
      }
      args.push('-t', String(segLen));
      if (!hasAudio) {
        args.push('-map', '0:v', '-map', '1:a');
      } else {
        args.push('-map', '0:v', '-map', '0:a:0');
      }
      args.push(
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-r',
        '30',
        ...AUDIO_ENC,
        '-movflags',
        '+faststart',
        segOut,
      );

      const err = await runFfmpeg(ffmpegPath, args, dir);
      stderrTails.push(err.trim().slice(-400));
      segmentPaths.push(segOut);
      params.onProgress?.(progressForEncode(segmentPaths.length, segmentTotal));
    }

    if (segmentPaths.length === 0) {
      throw new Error('No segments produced (duration / trim invalid).');
    }

    log.segment_overlays = segmentOverlayLog;

    params.onProgress?.(progressForStage('concat'));

    const concatList = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    const concatPath = path.join(dir, 'concat.txt');
    fs.writeFileSync(concatPath, concatList, 'utf8');

    const bodyPath = path.join(dir, 'body.mp4');
    await runFfmpeg(
      ffmpegPath,
      ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', bodyPath],
      dir,
    );

    let finalPath = bodyPath;

    if (includeOutro) {
      const outroTextPath = path.join(dir, 'outro.txt');
      fs.writeFileSync(outroTextPath, OUTRO_DEFAULT_LINES.join('\n'), 'utf8');
      const outroPath = path.join(dir, 'outro.mp4');
      const outroDraw = font
        ? `drawtext=fontfile='${escapeDrawtextPath(font)}':textfile='${escapeDrawtextPath(outroTextPath)}':reload=1:fontsize=40:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2`
        : null;
      const outroArgs = [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${TARGET_W}x${TARGET_H}:d=2:r=30`,
        '-f',
        'lavfi',
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`,
        '-t',
        '2',
        ...(outroDraw ? ['-vf', outroDraw] : []),
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'medium',
        '-crf',
        '23',
        ...AUDIO_ENC,
        outroPath,
      ];
      await runFfmpeg(ffmpegPath, outroArgs, dir);

      const withOutroPath = path.join(dir, 'with_outro.mp4');
      await runFfmpeg(
        ffmpegPath,
        [
          '-y',
          '-loglevel',
          'error',
          '-i',
          bodyPath,
          '-i',
          outroPath,
          '-filter_complex',
          '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]',
          '-map',
          '[outv]',
          '-map',
          '[outa]',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-preset',
          'medium',
          '-crf',
          '23',
          ...AUDIO_ENC,
          '-movflags',
          '+faststart',
          withOutroPath,
        ],
        dir,
      );
      finalPath = withOutroPath;
    }

    const outMp4 = path.join(dir, 'out_faststart.mp4');
    await runFfmpeg(
      ffmpegPath,
      ['-y', '-loglevel', 'error', '-i', finalPath, '-c', 'copy', '-movflags', '+faststart', outMp4],
      dir,
    );

    const mp4 = fs.readFileSync(outMp4);
    const probeOut = await probeVideo(outMp4);
    log.stderr_tails = stderrTails;
    log.duration_seconds = probeOut.durationSeconds;
    log.has_audio = probeOut.hasAudio;

    let thumbnailJpeg: Buffer | null = null;
    try {
      params.onProgress?.(progressForStage('thumbnail'));
      const thumbPath = path.join(dir, 'thumb.jpg');
      await runFfmpeg(
        ffmpegPath,
        ['-y', '-loglevel', 'error', '-ss', '0.5', '-i', outMp4, '-frames:v', '1', '-q:v', '3', thumbPath],
        dir,
      );
      if (fs.existsSync(thumbPath)) thumbnailJpeg = fs.readFileSync(thumbPath);
    } catch {
      log.thumbnail_error = true;
    }

    return {
      mp4,
      thumbnailJpeg,
      durationSec: probeOut.durationSeconds,
      log,
    };
  });
}

export { hasDrawtextFilter, resolveFfmpegBin };
