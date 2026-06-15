import type { SupabaseClient } from '@supabase/supabase-js';
import type { drive_v3 } from 'googleapis';
import { z } from 'zod';

import { formatGoogleDriveApiError } from './google-drive-auth.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const ALL_POST_TYPES = [
  'reel',
  'story_sequence',
  'carousel',
  'static_post',
  'sponsor_post',
  'archive_note',
] as const;

const postTypeEnum = z.enum(ALL_POST_TYPES);

const llmCandidateSchema = z.object({
  post_type: postTypeEnum,
  title: z.string(),
  hook: z.string().optional(),
  concept_summary: z.string().optional(),
  rationale: z.string().optional(),
  caption_fr: z.string(),
  caption_en: z.string().optional(),
  hashtags: z.array(z.string()),
  source_asset_ids: z.array(z.string()),
  source_drive_file_ids: z.array(z.string()),
  priority_score: z.number().min(0).max(10).optional().default(5),
  mission_score: z.number().min(0).max(10).optional().default(5),
  human_score: z.number().min(0).max(10).optional().default(5),
  sponsor_safety_score: z.number().min(0).max(10).optional().default(5),
  effort_score: z.number().min(0).max(10).optional().default(5),
  story_frames: z.any().optional(),
  reel_instructions: z.any().optional(),
  carousel_slides: z.any().optional(),
  static_post_instructions: z.any().optional(),
  selected_series: z.string().optional(),
  narrative_function: z.string().optional(),
  series_reasoning: z.string().optional(),
  target_audience: z.string().optional(),
  asset_fit_score: z.number().min(0).max(10).optional(),
  caption_strategy: z.string().optional(),
  overlay_strategy: z.string().optional(),
  cta_strategy: z.string().optional(),
  warnings: z.array(z.string()).optional(),
});

export type CandidateSourceAsset = {
  id: string;
  drive_file_id: string;
  current_filename: string | null;
  final_filename: string | null;
  media_type: string | null;
  activity: string | null;
  content_lane: string | null;
  suggested_title: string | null;
  visual_summary: string | null;
  semantic_summary: string | null;
  transcript: string | null;
  audio_transcript: string | null;
  tags: string[] | null;
  quality_score: number | string | null;
  mission_score: number | string | null;
  human_score: number | string | null;
  sponsor_safety_score: number | string | null;
  processed_at: string | null;
  geo_label: string | null;
  geo_locality: string | null;
  postal_code: string | null;
  duration_seconds: number | string | null;
  drive_web_view_link: string | null;
  analysis_status: string | null;
  capture_time?: string | null;
  drive_created_time?: string | null;
  imported_at?: string | null;
  usage_status?: string | null;
  hard_locked?: boolean | null;
  reuse_allowed_after?: string | null;
  candidate_eligibility?: string | null;
};

export type ValidatedPostCandidate = z.infer<typeof llmCandidateSchema> & {
  source_drive_file_ids: string[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function storyFramesValue(v: unknown): unknown[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  return null;
}

function jsonObjectValue(v: unknown): Record<string, unknown> | null {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function extractTitleOverlayFromValidated(c: ValidatedPostCandidate): string | null {
  const reel = c.reel_instructions;
  if (reel != null && typeof reel === 'object' && !Array.isArray(reel)) {
    const t = (reel as Record<string, unknown>).thumbnail_text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  const st = c.static_post_instructions;
  if (st != null && typeof st === 'object' && !Array.isArray(st)) {
    const t = (st as Record<string, unknown>).main_text;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

function resolveSourceAssetRef(
  raw: string,
  assetById: Map<string, CandidateSourceAsset>,
  assetByDriveId: Map<string, CandidateSourceAsset>,
): CandidateSourceAsset | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return assetById.get(trimmed) ?? assetByDriveId.get(trimmed) ?? null;
}

export function resolveSourceAssetIds(
  rawIds: string[],
  rawDriveIds: string[],
  assetById: Map<string, CandidateSourceAsset>,
  assetByDriveId: Map<string, CandidateSourceAsset>,
): { ids: string[]; driveIds: string[]; repairs: string[] } | { error: string } {
  const repairs: string[] = [];
  const resolvedIds: string[] = [];
  const resolvedDriveIds: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rawIds.length; i++) {
    const raw = rawIds[i]?.trim() ?? '';
    if (!raw) {
      return { error: `empty source_asset_ids entry at index ${i}` };
    }

    let asset = resolveSourceAssetRef(raw, assetById, assetByDriveId);
    if (!asset && rawDriveIds.length === rawIds.length) {
      const driveRaw = rawDriveIds[i]?.trim() ?? '';
      if (driveRaw) {
        asset = assetByDriveId.get(driveRaw) ?? null;
        if (asset) {
          repairs.push(`source_asset_ids[${i}]: paired via source_drive_file_ids[${i}]`);
        }
      }
    }

    if (!asset) {
      return { error: `unknown asset id ${raw}` };
    }

    if (raw !== asset.id && !assetById.has(raw)) {
      repairs.push(`source_asset_ids[${i}]: ${raw} -> ${asset.id}`);
    }

    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    resolvedIds.push(asset.id);
    resolvedDriveIds.push(asset.drive_file_id);
  }

  return { ids: resolvedIds, driveIds: resolvedDriveIds, repairs };
}

export async function getCandidateSourceAssets(
  supabase: SupabaseClient,
  params: { maxAssets: number },
): Promise<CandidateSourceAsset[]> {
  const fetchLimit = Math.min(Math.max(params.maxAssets * 4, params.maxAssets), 500);

  const { data, error } = await supabase
    .from('content_assets')
    .select(
      [
        'id',
        'drive_file_id',
        'current_filename',
        'final_filename',
        'media_type',
        'activity',
        'content_lane',
        'suggested_title',
        'visual_summary',
        'semantic_summary',
        'transcript',
        'audio_transcript',
        'tags',
        'quality_score',
        'mission_score',
        'human_score',
        'sponsor_safety_score',
        'processed_at',
        'capture_time',
        'drive_created_time',
        'imported_at',
        'geo_label',
        'geo_locality',
        'postal_code',
        'duration_seconds',
        'drive_web_view_link',
        'analysis_status',
        'usage_status',
        'hard_locked',
        'candidate_eligibility',
      ].join(', '),
    )
    .eq('status', 'processed')
    .eq('analysis_status', 'complete')
    .in('candidate_eligibility', ['eligible', 'needs_review'])
    .not('quality_score', 'is', null)
    .or('content_lane.is.null,content_lane.neq.archive')
    .order('processed_at', { ascending: false })
    .limit(fetchLimit);

  if (error) throw error;
  const rows = data ?? [];
  return rows.slice(0, params.maxAssets) as unknown as CandidateSourceAsset[];
}

export function validatePostCandidateOutput(
  raw: unknown,
  assetById: Map<string, CandidateSourceAsset>,
  enabledPostTypes?: Set<string>,
  assetByDriveId?: Map<string, CandidateSourceAsset>,
): { ok: true; data: ValidatedPostCandidate } | { ok: false; error: string } {
  const parsed = llmCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  const c = parsed.data;
  if (enabledPostTypes && !enabledPostTypes.has(c.post_type)) {
    return { ok: false, error: `disabled post_type ${c.post_type}` };
  }
  const title = c.title?.trim();
  if (!title) {
    return { ok: false, error: 'empty title' };
  }
  if (!c.source_asset_ids.length) {
    return { ok: false, error: 'source_asset_ids empty' };
  }

  const driveLookup = assetByDriveId ?? new Map<string, CandidateSourceAsset>();
  const resolved = resolveSourceAssetIds(
    c.source_asset_ids,
    c.source_drive_file_ids,
    assetById,
    driveLookup,
  );
  if ('error' in resolved) {
    return { ok: false, error: resolved.error };
  }

  let driveIds = c.source_drive_file_ids;
  const mismatched =
    driveIds.length !== resolved.driveIds.length ||
    driveIds.some((id, i) => id !== resolved.driveIds[i]);
  if (mismatched) {
    driveIds = resolved.driveIds;
  }

  return {
    ok: true,
    data: {
      ...c,
      title,
      source_asset_ids: resolved.ids,
      source_drive_file_ids: driveIds,
    },
  };
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export async function createReviewDriveFolder(
  drive: drive_v3.Drive,
  params: { parentFolderId: string; folderName: string },
): Promise<{ id: string; name: string; webViewLink: string | null }> {
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: params.folderName,
      mimeType: FOLDER_MIME,
      parents: [params.parentFolderId],
    },
    fields: 'id, name, webViewLink',
  });
  const id = res.data.id;
  const name = res.data.name ?? params.folderName;
  if (!id) {
    throw new Error('Drive folder create returned no id');
  }
  return {
    id,
    name,
    webViewLink: res.data.webViewLink ?? null,
  };
}

export async function copyAssetsToReviewFolder(
  drive: drive_v3.Drive,
  params: { driveFileIds: string[]; destFolderId: string },
): Promise<{ copied: number; failures: Array<{ drive_file_id: string; message: string }> }> {
  const failures: Array<{ drive_file_id: string; message: string }> = [];
  let copied = 0;

  for (const fileId of params.driveFileIds) {
    try {
      const meta = await drive.files.get({
        fileId,
        fields: 'name',
        supportsAllDrives: true,
      });
      const name = meta.data.name;
      if (!name?.trim()) {
        failures.push({ drive_file_id: fileId, message: 'Drive file has no name' });
        continue;
      }

      await drive.files.copy({
        fileId,
        supportsAllDrives: true,
        requestBody: {
          name,
          parents: [params.destFolderId],
        },
      });
      copied += 1;
    } catch (e) {
      failures.push({
        drive_file_id: fileId,
        message: formatGoogleDriveApiError(e),
      });
    }
  }

  return { copied, failures };
}

export async function insertPostCandidate(
  supabase: SupabaseClient,
  params: {
    id: string;
    candidateDate: string;
    c: ValidatedPostCandidate;
    llmModel: string;
    llmRaw: Record<string, unknown>;
  },
): Promise<{ error: string | null }> {
  const sf = storyFramesValue(params.c.story_frames);
  const reel = jsonObjectValue(params.c.reel_instructions);
  const slides = storyFramesValue(params.c.carousel_slides);
  const staticInst = jsonObjectValue(params.c.static_post_instructions);

  const row = {
    id: params.id,
    candidate_date: params.candidateDate,
    platform: 'instagram',
    post_type: params.c.post_type,
    title: params.c.title.trim(),
    hook: params.c.hook?.trim() || null,
    concept_summary: params.c.concept_summary?.trim() || null,
    rationale: params.c.rationale?.trim() || null,
    caption_fr: params.c.caption_fr,
    caption_en: params.c.caption_en?.trim() ? params.c.caption_en.trim() : null,
    hashtags: params.c.hashtags,
    story_frames: sf ?? [],
    reel_instructions: reel ?? {},
    carousel_slides: slides ?? [],
    static_post_instructions: staticInst ?? {},
    source_asset_ids: params.c.source_asset_ids,
    source_drive_file_ids: params.c.source_drive_file_ids,
    priority_score: params.c.priority_score,
    mission_score: params.c.mission_score,
    human_score: params.c.human_score,
    sponsor_safety_score: params.c.sponsor_safety_score,
    effort_score: params.c.effort_score,
    status: 'needs_review',
    selected_series: params.c.selected_series?.trim() || null,
    narrative_function: params.c.narrative_function?.trim() || null,
    title_overlay: extractTitleOverlayFromValidated(params.c),
    llm_model: params.llmModel,
    llm_raw: params.llmRaw,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('post_candidates').insert(row);
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}
