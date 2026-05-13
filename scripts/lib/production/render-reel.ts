import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import ffmpegPathDefault from 'ffmpeg-static';

import { probeVideo, withTempDir } from '../video-preprocess.js';

const OUTRO_DEFAULT_LINES = ['94 triathlons · 94 jours · 94 départements'];
const MAX_SOURCES = 3;
const MAX_SEGMENT_SEC = 15;
const MAX_TOTAL_SEC = 60;
const TARGET_W = 1080;
const TARGET_H = 1920;

function ffmpegBin(): string {
  const p =
    (typeof ffmpegPathDefault === 'string' ? ffmpegPathDefault : null) ??
    process.env.FFMPEG_PATH ??
    null;
  if (!p) throw new Error('ffmpeg binary not found (ffmpeg-static).');
  return p;
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

async function runFfmpeg(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
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

type ClipSpec = { startSec: number; endSec: number | null };

function parseInstructions(raw: unknown): {
  clips: ClipSpec[];
  overlayLines: string[];
  includeOutro: boolean;
} {
  const clips: ClipSpec[] = [];
  const overlayLines: string[] = [];
  let includeOutro = true;

  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;

    const c = o.clips;
    if (Array.isArray(c)) {
      for (const x of c) {
        if (x == null || typeof x !== 'object') continue;
        const row = x as Record<string, unknown>;
        const start = typeof row.start === 'number' ? row.start : Number(row.start);
        const end = typeof row.end === 'number' ? row.end : Number(row.end);
        const startSec = Number.isFinite(start) && start >= 0 ? start : 0;
        const endSec = Number.isFinite(end) && end > startSec ? end : null;
        clips.push({ startSec, endSec });
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

  return { clips, overlayLines, includeOutro };
}

function scaleCropFilter(): string {
  return `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},setsar=1`;
}

function escapeDrawtextPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Deterministic 9:16 reel draft: trim → H.264 1080×1920 → optional text → optional outro → faststart MP4 (no audio v1).
 */
export async function renderReel(params: {
  sourceVideos: Buffer[];
  instructions: unknown;
}): Promise<{ mp4: Buffer; durationSec: number | null; log: Record<string, unknown> }> {
  const buffers = params.sourceVideos.slice(0, MAX_SOURCES);
  if (buffers.length === 0) {
    throw new Error('renderReel: no source videos');
  }

  const { clips: clipSpecsRaw, overlayLines, includeOutro } = parseInstructions(params.instructions);
  const clipSpecs: ClipSpec[] = [];
  for (let i = 0; i < buffers.length; i++) {
    clipSpecs.push(clipSpecsRaw[i] ?? { startSec: 0, endSec: null });
  }

  const font = pickFontFile();
  const log: Record<string, unknown> = {
    target: `${TARGET_W}x${TARGET_H}`,
    segments: buffers.length,
    font: font ?? 'none',
    overlay_lines: overlayLines.length,
    include_outro: includeOutro,
  };

  return withTempDir('fr94-reel-', async (dir) => {
    const segmentPaths: string[] = [];
    let totalUsed = 0;
    const stderrTails: string[] = [];

    for (let i = 0; i < buffers.length; i++) {
      const inPath = path.join(dir, `src_${i}.bin`);
      fs.writeFileSync(inPath, buffers[i]!);
      const probe = await probeVideo(inPath);
      const dur = probe.durationSeconds ?? 0;
      const spec = clipSpecs[i] ?? { startSec: 0, endSec: null };
      let start = Math.max(0, spec.startSec);
      let end = spec.endSec != null && spec.endSec > start ? spec.endSec : null;
      if (dur > 0) {
        start = Math.min(start, Math.max(0, dur - 0.05));
        if (end != null) end = Math.min(end, dur);
      }
      let segLen =
        end != null ? end - start : dur > 0 ? Math.min(MAX_SEGMENT_SEC, dur - start) : MAX_SEGMENT_SEC;
      if (!Number.isFinite(segLen) || segLen <= 0) segLen = Math.min(MAX_SEGMENT_SEC, dur || MAX_SEGMENT_SEC);
      if (totalUsed + segLen > MAX_TOTAL_SEC) {
        segLen = Math.max(0.1, MAX_TOTAL_SEC - totalUsed);
      }
      if (segLen <= 0) break;
      totalUsed += segLen;

      const segOut = path.join(dir, `seg_${i}.mp4`);
      const vfBase = scaleCropFilter();

      const textRel = `ol_${i}.txt`;
      const textAbs = path.join(dir, textRel);
      const overlay =
        overlayLines.length > 0 && font ?
          `,drawtext=fontfile='${escapeDrawtextPath(font)}':textfile='${escapeDrawtextPath(textAbs)}':reload=1:fontsize=42:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8:x=(w-text_w)/2:y=h-text_h-120:enable='between(t,0,3)'`
        : '';

      if (overlay) {
        fs.writeFileSync(textAbs, overlayLines.slice(0, 3).join('\n'), 'utf8');
      }

      const args = [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(start),
        '-i',
        inPath,
        '-t',
        String(segLen),
        '-vf',
        vfBase + overlay,
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
        '-an',
        '-movflags',
        '+faststart',
        segOut,
      ];

      const err = await runFfmpeg(args, dir);
      stderrTails.push(err.trim().slice(-400));
      segmentPaths.push(segOut);
      if (totalUsed >= MAX_TOTAL_SEC) break;
    }

    if (segmentPaths.length === 0) {
      throw new Error('No segments produced (duration / trim invalid).');
    }

    let concatList = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    let concatPath = path.join(dir, 'concat.txt');
    fs.writeFileSync(concatPath, concatList, 'utf8');

    let bodyPath = path.join(dir, 'body.mp4');
    await runFfmpeg(
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatPath,
        '-c',
        'copy',
        bodyPath,
      ],
      dir,
    );

    let finalPath = bodyPath;

    if (includeOutro) {
      const outroTextPath = path.join(dir, 'outro.txt');
      fs.writeFileSync(outroTextPath, OUTRO_DEFAULT_LINES.join('\n'), 'utf8');
      const outroPath = path.join(dir, 'outro.mp4');
      if (font) {
        await runFfmpeg(
          [
            '-y',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            `color=c=black:s=${TARGET_W}x${TARGET_H}:d=2:r=30`,
            '-vf',
            `drawtext=fontfile='${escapeDrawtextPath(font)}':textfile='${escapeDrawtextPath(outroTextPath)}':reload=1:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=8:x=(w-text_w)/2:y=(h-text_h)/2`,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-preset',
            'medium',
            '-crf',
            '23',
            '-an',
            outroPath,
          ],
          dir,
        );
      } else {
        await runFfmpeg(
          [
            '-y',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            `color=c=black:s=${TARGET_W}x${TARGET_H}:d=2:r=30`,
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-preset',
            'medium',
            '-crf',
            '23',
            '-an',
            outroPath,
          ],
          dir,
        );
      }

      await runFfmpeg(
        [
          '-y',
          '-loglevel',
          'error',
          '-i',
          bodyPath,
          '-i',
          outroPath,
          '-filter_complex',
          '[0:v][1:v]concat=n=2:v=1:a=0[outv]',
          '-map',
          '[outv]',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-preset',
          'medium',
          '-crf',
          '23',
          '-an',
          '-movflags',
          '+faststart',
          path.join(dir, 'with_outro.mp4'),
        ],
        dir,
      );
      finalPath = path.join(dir, 'with_outro.mp4');
    } else {
      finalPath = bodyPath;
    }

    const outMp4 = path.join(dir, 'out_faststart.mp4');
    await runFfmpeg(
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        finalPath,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outMp4,
      ],
      dir,
    );

    const mp4 = fs.readFileSync(outMp4);
    const probeOut = await probeVideo(outMp4);
    log.stderr_tails = stderrTails;
    log.duration_seconds = probeOut.durationSeconds;

    return {
      mp4,
      durationSec: probeOut.durationSeconds,
      log,
    };
  });
}
