import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import ffmpegPathDefault from 'ffmpeg-static';

import { probeVideo, withTempDir } from '../video-preprocess.js';

function ffmpegBin(): string {
  const p =
    (typeof ffmpegPathDefault === 'string' ? ffmpegPathDefault : null) ??
    process.env.FFMPEG_PATH ??
    null;
  if (!p) {
    throw new Error('ffmpeg binary not found (ffmpeg-static).');
  }
  return p;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new Error(`ffmpeg exited ${code}: ${tail}`));
      }
    });
  });
}

export type NormalizedVideo = {
  buffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
};

/**
 * Repackage to MP4 H.264 + AAC, faststart. No cuts/overlays.
 * Uses `-an` when source has no audio (Instagram feed/video constraints vary; silent MP4 is acceptable for many cases).
 */
export async function normalizeVideoForInstagram(buffer: Buffer): Promise<NormalizedVideo> {
  return withTempDir('fr94-publish-vid-', async (dir) => {
    const inPath = path.join(dir, 'source.bin');
    const outPath = path.join(dir, 'out.mp4');
    fs.writeFileSync(inPath, buffer);

    const probeIn = await probeVideo(inPath);
    const maps = probeIn.hasAudio
      ? (['-map', '0:v:0', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'] as const)
      : (['-map', '0:v:0', '-an'] as const);

    await runFfmpeg([
      '-y',
      '-loglevel',
      'error',
      '-i',
      inPath,
      ...maps,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const outBuf = fs.readFileSync(outPath);
    const probeOut = await probeVideo(outPath);
    return {
      buffer: outBuf,
      mimeType: 'video/mp4',
      width: probeOut.width,
      height: probeOut.height,
      duration_seconds: probeOut.durationSeconds,
    };
  });
}
