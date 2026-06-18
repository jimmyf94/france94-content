import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { assetThumbnailBucketName } from './asset-thumbnail.js';
import { extractFrames, withTempDir } from './video-preprocess.js';

/** Clip metadata as produced by the full-video ingest analysis (pre-insert). */
export type ParsedClip = {
  start_sec: number;
  end_sec: number;
  visual_summary: string;
  transcript_excerpt: string;
  supported_reel_formats: string[];
  fitting_series_slugs: string[];
  pov_concepts: string[];
  hooks: string[];
  emotional_tags: string[];
  tension_tags: string[];
  visual_tags: string[];
  discovery_tags: string[];
  could_be_used_for: string[];
};

export type ContentClipRow = ParsedClip & {
  id: string;
  content_asset_id: string;
  seq: number;
  duration_sec: number;
  thumbnail_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export function clipThumbnailObjectPath(clipId: string): string {
  return `clips/${clipId.trim()}.jpg`;
}

const CLIP_THUMB_MAX_WIDTH = 512;
/** CDN cache TTL (seconds); Smart CDN revalidates on upsert/delete. */
const STORAGE_CACHE_CONTROL = '31536000';

/**
 * Sanitize LLM clip output against the real video duration:
 * clamp times, drop empty/invalid ranges, sort and de-overlap.
 */
export function sanitizeParsedClips(clips: ParsedClip[], durationSeconds: number | null): ParsedClip[] {
  const maxEnd = durationSeconds != null && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  const cleaned = clips
    .map((c) => ({
      ...c,
      start_sec: Math.max(0, c.start_sec),
      end_sec: Math.min(c.end_sec, maxEnd),
    }))
    .filter((c) => Number.isFinite(c.start_sec) && Number.isFinite(c.end_sec) && c.end_sec - c.start_sec >= 0.5)
    .sort((a, b) => a.start_sec - b.start_sec);

  const out: ParsedClip[] = [];
  let prevEnd = 0;
  for (const c of cleaned) {
    const start = Math.max(c.start_sec, prevEnd);
    if (c.end_sec - start < 0.5) continue;
    out.push({ ...c, start_sec: start });
    prevEnd = c.end_sec;
  }
  return out;
}

/**
 * Replace clips for an asset: delete existing rows, insert new ones with
 * client-generated ids, and upload a per-clip JPEG thumbnail (frame at clip
 * midpoint) to the asset-thumbnails bucket. Thumbnail failures are non-fatal.
 */
export async function replaceContentClips(
  supabase: SupabaseClient,
  params: {
    contentAssetId: string;
    clips: ParsedClip[];
    videoBuffer: Buffer;
    fileExtension: string;
  },
): Promise<{ inserted: number; thumbnails: number }> {
  const { contentAssetId, clips, videoBuffer, fileExtension } = params;

  const { error: delErr } = await supabase
    .from('content_clips')
    .delete()
    .eq('content_asset_id', contentAssetId);
  if (delErr) throw new Error(`content_clips delete failed: ${delErr.message}`);

  if (clips.length === 0) return { inserted: 0, thumbnails: 0 };

  const ids = clips.map(() => randomUUID());

  let thumbPaths: Array<string | null> = clips.map(() => null);
  try {
    thumbPaths = await withTempDir('fr94-clip-thumbs-', async (dir) => {
      const inputPath = path.join(dir, `input.${fileExtension || 'mp4'}`);
      fs.writeFileSync(inputPath, videoBuffer);
      const midpoints = clips.map((c) => +((c.start_sec + c.end_sec) / 2).toFixed(3));
      const frames = await extractFrames(inputPath, midpoints, dir, CLIP_THUMB_MAX_WIDTH);
      const bucket = assetThumbnailBucketName();
      const out: Array<string | null> = [];
      for (let i = 0; i < clips.length; i++) {
        const framePath = frames[i];
        if (!framePath || !fs.existsSync(framePath)) {
          out.push(null);
          continue;
        }
        const objectPath = clipThumbnailObjectPath(ids[i]!);
        const { error } = await supabase.storage
          .from(bucket)
          .upload(objectPath, fs.readFileSync(framePath), {
            contentType: 'image/jpeg',
            upsert: true,
            cacheControl: STORAGE_CACHE_CONTROL,
          });
        out.push(error ? null : objectPath);
      }
      return out;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[clips] thumbnail extraction failed (non-fatal): ${msg}`);
  }

  const now = new Date().toISOString();
  const rows = clips.map((c, i) => ({
    id: ids[i],
    content_asset_id: contentAssetId,
    seq: i,
    start_sec: c.start_sec,
    end_sec: c.end_sec,
    visual_summary: c.visual_summary,
    transcript_excerpt: c.transcript_excerpt || null,
    supported_reel_formats: c.supported_reel_formats,
    fitting_series_slugs: c.fitting_series_slugs,
    pov_concepts: c.pov_concepts,
    hooks: c.hooks,
    emotional_tags: c.emotional_tags,
    tension_tags: c.tension_tags,
    visual_tags: c.visual_tags,
    discovery_tags: c.discovery_tags,
    could_be_used_for: c.could_be_used_for,
    thumbnail_path: thumbPaths[i],
    status: 'ready',
    created_at: now,
    updated_at: now,
  }));

  const { error: insErr } = await supabase.from('content_clips').insert(rows);
  if (insErr) throw new Error(`content_clips insert failed: ${insErr.message}`);

  return { inserted: rows.length, thumbnails: thumbPaths.filter(Boolean).length };
}

export type ClipWithAsset = ContentClipRow & {
  asset: {
    id: string;
    drive_file_id: string;
    current_filename: string | null;
    final_filename: string | null;
    duration_seconds: number | null;
    usage_status: string | null;
    quality_score: number | null;
    processed_at: string | null;
    status?: string | null;
    candidate_eligibility?: string | null;
  };
};

const CLIP_WITH_ASSET_COLUMNS = `
  id, content_asset_id, seq, duration_sec, thumbnail_path, status, created_at, updated_at,
  start_sec, end_sec, visual_summary, transcript_excerpt,
  supported_reel_formats, fitting_series_slugs, pov_concepts, hooks,
  emotional_tags, tension_tags, visual_tags, discovery_tags, could_be_used_for,
  asset:content_assets!inner (
    id, drive_file_id, current_filename, final_filename,
    duration_seconds, usage_status, quality_score, processed_at,
    status, candidate_eligibility
  )
`;

/**
 * Load ready clips (joined to eligible processed video assets) for reel generation.
 */
export async function loadReadyClipsForReels(
  supabase: SupabaseClient,
  params: { limit?: number } = {},
): Promise<ClipWithAsset[]> {
  const limit = params.limit ?? 200;
  const { data, error } = await supabase
    .from('content_clips')
    .select(CLIP_WITH_ASSET_COLUMNS)
    .eq('status', 'ready')
    .eq('content_assets.status', 'processed')
    .eq('content_assets.candidate_eligibility', 'eligible')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`loadReadyClipsForReels: ${error.message}`);
  return (data ?? []) as unknown as ClipWithAsset[];
}

/** Load specific clip rows (with asset join) by id. */
export async function loadClipsByIds(
  supabase: SupabaseClient,
  clipIds: string[],
): Promise<ClipWithAsset[]> {
  const ids = [...new Set(clipIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('content_clips')
    .select(CLIP_WITH_ASSET_COLUMNS)
    .in('id', ids);

  if (error) throw new Error(`loadClipsByIds: ${error.message}`);
  return (data ?? []) as unknown as ClipWithAsset[];
}
