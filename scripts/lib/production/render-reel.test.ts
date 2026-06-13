import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import ffmpegPathDefault from 'ffmpeg-static';

import { hasDrawtextFilter, renderReel, resolveFfmpegBin } from './render-reel.js';

function ffmpegBin(): string | null {
  return typeof ffmpegPathDefault === 'string' ? ffmpegPathDefault : null;
}

function createTinyMp4(outPath: string, seconds = 1): void {
  const bin = ffmpegBin();
  assert.ok(bin, 'ffmpeg-static required for render-reel tests');
  const result = spawnSync(
    bin,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=blue:s=1280x720:d=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${seconds}`,
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      outPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

describe('resolveFfmpegBin', () => {
  test('finds drawtext when overlay is required', () => {
    const resolved = resolveFfmpegBin(true);
    assert.ok(resolved.drawtextAvailable);
    assert.ok(fs.existsSync(resolved.bin));
    assert.equal(hasDrawtextFilter(resolved.bin), true);
  });

  test('returns a binary when overlay is not required', () => {
    const resolved = resolveFfmpegBin(false);
    assert.ok(fs.existsSync(resolved.bin));
  });
});

describe('renderReel multi-segment overlay', () => {
  test('renders two clips with drawtext overlay', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr94-reel-test-'));
    try {
      const srcPath = path.join(dir, 'src.mp4');
      createTinyMp4(srcPath, 2);
      const buffer = fs.readFileSync(srcPath);
      const assetId = 'asset-test-1';

      const result = await renderReel({
        sourceVideos: [buffer],
        sourceAssetIds: [assetId],
        instructions: {
          version: 'clips-v1',
          clips: [
            { asset_id: assetId, start_sec: 0, end_sec: 0.8, clip_id: 'c1' },
            { asset_id: assetId, start_sec: 1, end_sec: 1.8, clip_id: 'c2' },
          ],
          overlay_lines: ['pov : test overlay for multi clip reel'],
          text_style: {
            font_color: '#ffffff',
            outline_color: '#000000',
          },
        },
      });

      assert.ok(result.mp4.length > 0);
      assert.equal(result.log.segments, 2);
      assert.equal(result.log.drawtext_available, true);
      assert.ok(typeof result.log.ffmpeg_path === 'string');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('renders single segment without overlay when overlay lines empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr94-reel-test-'));
    try {
      const srcPath = path.join(dir, 'src.mp4');
      createTinyMp4(srcPath, 1);
      const buffer = fs.readFileSync(srcPath);
      const assetId = 'asset-test-2';

      const result = await renderReel({
        sourceVideos: [buffer],
        sourceAssetIds: [assetId],
        instructions: {
          version: 'clips-v1',
          clips: [{ asset_id: assetId, start_sec: 0, end_sec: 0.8, clip_id: 'c1' }],
          overlay_lines: [],
        },
      });

      assert.ok(result.mp4.length > 0);
      assert.equal(result.log.segments, 1);
      assert.equal(result.log.overlay_lines, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
