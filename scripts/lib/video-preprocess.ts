import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPathDefault from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const FFMPEG_PATH: string | null =
  (typeof ffmpegPathDefault === 'string' ? ffmpegPathDefault : null) ??
  process.env.FFMPEG_PATH ??
  null;

const FFPROBE_PATH: string | null = ffprobeStatic.path ?? process.env.FFPROBE_PATH ?? null;

function requireFfmpeg(): string {
  if (!FFMPEG_PATH) {
    throw new Error('ffmpeg binary not found (ffmpeg-static did not provide a path for this platform).');
  }
  return FFMPEG_PATH;
}

function requireFfprobe(): string {
  if (!FFPROBE_PATH) {
    throw new Error('ffprobe binary not found (ffprobe-static did not provide a path for this platform).');
  }
  return FFPROBE_PATH;
}

type RunResult = { stdout: string; stderr: string };

function runProcess(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const tail = stderr.trim().split('\n').slice(-5).join('\n');
        reject(new Error(`${path.basename(bin)} exited with code ${code}: ${tail}`));
      }
    });
  });
}

export type ProbeResult = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  raw: Record<string, unknown>;
};

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const { stdout } = await runProcess(requireFfprobe(), [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    filePath,
  ]);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`ffprobe returned invalid JSON: ${msg}`);
  }

  const streams = Array.isArray(parsed.streams) ? (parsed.streams as Array<Record<string, unknown>>) : [];
  const format = (parsed.format ?? {}) as Record<string, unknown>;

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const durationStr = (videoStream?.duration as string | undefined) ?? (format.duration as string | undefined);
  const durationSeconds = durationStr != null ? Number(durationStr) : null;

  const width = videoStream?.width != null ? Number(videoStream.width) : null;
  const height = videoStream?.height != null ? Number(videoStream.height) : null;

  return {
    durationSeconds: Number.isFinite(durationSeconds ?? NaN) ? (durationSeconds as number) : null,
    width: Number.isFinite(width ?? NaN) ? (width as number) : null,
    height: Number.isFinite(height ?? NaN) ? (height as number) : null,
    hasAudio: audioStream != null,
    raw: parsed,
  };
}

/**
 * Pick frame timestamps (seconds) given a video duration.
 *
 * Tiers:
 *  - duration <= 30s         : ~1 frame per 1.5s, evenly spaced away from start/end, capped at maxFrames
 *  - duration <= 180s        : 10%, 30%, 50%, 70%, 90%
 *  - duration > 180s         : 1 frame every step seconds, where step is clamped to [15, 30],
 *                              then capped at maxFrames samples
 */
export function pickFrameTimestamps(durationSeconds: number, maxFrames: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];

  const cap = Math.max(1, Math.floor(maxFrames));

  if (durationSeconds <= 30) {
    const ideal = Math.ceil(durationSeconds / 1.5);
    const n = Math.max(2, Math.min(cap, ideal));
    return Array.from({ length: n }, (_, i) =>
      +(((durationSeconds * (i + 1)) / (n + 1)).toFixed(3)),
    );
  }

  if (durationSeconds <= 180) {
    return [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => +(durationSeconds * p).toFixed(3)).slice(0, cap);
  }

  const idealStep = Math.ceil(durationSeconds / cap);
  const step = Math.min(30, Math.max(15, idealStep));
  const out: number[] = [];
  for (let t = step; t < durationSeconds && out.length < cap; t += step) {
    out.push(+t.toFixed(3));
  }
  if (out.length === 0) {
    out.push(+(durationSeconds * 0.5).toFixed(3));
  }
  return out;
}

export async function extractFrames(
  filePath: string,
  timestamps: number[],
  outDir: string,
  maxWidth: number,
): Promise<string[]> {
  const ffmpeg = requireFfmpeg();
  const out: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]!;
    const framePath = path.join(outDir, `frame_${String(i + 1).padStart(3, '0')}.jpg`);
    await runProcess(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(t),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-vf',
      `scale='min(${maxWidth},iw)':-2`,
      '-q:v',
      '3',
      framePath,
    ]);
    out.push(framePath);
  }

  return out;
}

export async function extractAudio(filePath: string, outPath: string): Promise<void> {
  const ffmpeg = requireFfmpeg();
  await runProcess(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    outPath,
  ]);
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[cleanup] removed ${dir}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[warn] failed to cleanup temp dir ${dir}: ${msg}`);
    }
  }
}
