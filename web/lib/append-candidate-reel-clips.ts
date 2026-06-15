import type { ClipWithAsset } from '@fr94/content-clips';
import { REEL_MAX_CLIPS } from '@fr94/reel-clip-limits';

export type ReelClipPoolEntry = {
  clip_id: string;
  asset_id: string;
  drive_file_id: string;
  start_sec: number;
  end_sec: number;
  why?: string;
};

export type AppendReelClipsResult = {
  reel_instructions: Record<string, unknown>;
  selected_clip_ids: string[];
  source_asset_ids: string[];
  source_drive_file_ids: string[];
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parseExistingClips(reelInstructions: unknown): ReelClipPoolEntry[] {
  if (reelInstructions == null || typeof reelInstructions !== 'object' || Array.isArray(reelInstructions)) {
    return [];
  }
  const raw = reelInstructions as Record<string, unknown>;
  if (raw.version !== 'clips-v1' || !Array.isArray(raw.clips)) return [];
  const out: ReelClipPoolEntry[] = [];
  for (const clipRaw of raw.clips) {
    if (clipRaw == null || typeof clipRaw !== 'object' || Array.isArray(clipRaw)) continue;
    const c = clipRaw as Record<string, unknown>;
    const clip_id = typeof c.clip_id === 'string' ? c.clip_id.trim() : '';
    const asset_id = typeof c.asset_id === 'string' ? c.asset_id.trim() : '';
    const drive_file_id = typeof c.drive_file_id === 'string' ? c.drive_file_id.trim() : '';
    const start_sec = Number(c.start_sec);
    const end_sec = Number(c.end_sec);
    if (!clip_id || !asset_id || !Number.isFinite(start_sec) || !Number.isFinite(end_sec)) continue;
    out.push({
      clip_id,
      asset_id,
      drive_file_id,
      start_sec,
      end_sec,
      why: typeof c.why === 'string' ? c.why : undefined,
    });
  }
  return out;
}

function clipToPoolEntry(clip: ClipWithAsset): ReelClipPoolEntry {
  const driveFileId = typeof clip.asset?.drive_file_id === 'string' ? clip.asset.drive_file_id.trim() : '';
  return {
    clip_id: clip.id,
    asset_id: clip.content_asset_id,
    drive_file_id: driveFileId,
    start_sec: Number(clip.start_sec),
    end_sec: Number(clip.end_sec),
  };
}

export function appendReelClips(params: {
  reel_instructions: unknown;
  source_asset_ids: unknown;
  source_drive_file_ids: unknown;
  newClips: ClipWithAsset[];
  maxClips?: number;
}): AppendReelClipsResult | { error: string } {
  const maxClips = params.maxClips ?? REEL_MAX_CLIPS;
  const existing = parseExistingClips(params.reel_instructions);
  const attached = new Set(existing.map((c) => c.clip_id.toLowerCase()));

  if (params.newClips.length === 0) {
    return { error: 'No clips to add' };
  }

  if (existing.length + params.newClips.length > maxClips) {
    return { error: `Reel clip pool exceeds limit (${maxClips}).` };
  }

  const nextClips = [...existing];
  for (const clip of params.newClips) {
    const id = clip.id.trim();
    if (!id) return { error: 'Invalid clip id' };
    if (attached.has(id.toLowerCase())) {
      return { error: 'Clip is already attached to this candidate' };
    }
    if (clip.status !== 'ready') {
      return { error: `Clip ${id} is not ready` };
    }
    const assetStatus = clip.asset?.status;
    if (assetStatus !== 'processed') {
      return { error: `Clip ${id} asset is not processed` };
    }
    const driveFileId =
      typeof clip.asset?.drive_file_id === 'string' ? clip.asset.drive_file_id.trim() : '';
    if (!driveFileId) {
      return { error: `Clip ${id} has no drive file id` };
    }
    attached.add(id.toLowerCase());
    nextClips.push(clipToPoolEntry(clip));
  }

  const base =
    params.reel_instructions != null &&
    typeof params.reel_instructions === 'object' &&
    !Array.isArray(params.reel_instructions)
      ? { ...(params.reel_instructions as Record<string, unknown>) }
      : {};

  const selected_clip_ids = nextClips.map((c) => c.clip_id);
  const source_asset_ids = [...new Set(nextClips.map((c) => c.asset_id))];
  const source_drive_file_ids = [...new Set(nextClips.map((c) => c.drive_file_id).filter(Boolean))];

  return {
    reel_instructions: {
      ...base,
      version: 'clips-v1',
      clips: nextClips,
    },
    selected_clip_ids,
    source_asset_ids,
    source_drive_file_ids,
  };
}

export function collectAttachedClipIds(reelInstructions: unknown, selectedClipIds: unknown): string[] {
  const fromSpec = parseExistingClips(reelInstructions).map((c) => c.clip_id);
  const fromColumn = normalizeStringArray(selectedClipIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...fromSpec, ...fromColumn]) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}
