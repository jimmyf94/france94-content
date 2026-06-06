/** Shared contracts for /content/assets and /api/content-assets. */

export const ASSET_ELIGIBILITY_VALUES = [
  'eligible',
  'excluded',
  'stale',
  'manual_only',
  'needs_review',
] as const;

export type AssetEligibility = (typeof ASSET_ELIGIBILITY_VALUES)[number];

export type AssetListRow = {
  id: string;
  drive_file_id: string;
  drive_web_view_link: string | null;
  original_filename: string | null;
  current_filename: string | null;
  final_filename: string | null;
  mime_type: string | null;
  media_type: string | null;
  activity: string | null;
  content_lane: string | null;
  quality_score: number | string | null;
  candidate_eligibility: string | null;
  usage_count: number | null;
  suggestion_count: number | null;
  last_used_at: string | null;
  last_suggested_at: string | null;
  processed_at: string | null;
  thumbnail_link: string | null;
  /** Same-origin ffmpeg poster when Drive has no video thumb. */
  poster_url?: string | null;
  /** Same-origin resized JPEG when Drive has no image thumb. */
  still_url?: string | null;
};

export type AssetUsageEventDto = {
  id: string;
  usage_stage: string;
  usage_type: string;
  event_kind: string | null;
  post_type: string | null;
  post_candidate_id: string | null;
  publishing_job_id: string | null;
  platform: string | null;
  notes: string | null;
  used_at: string | null;
  published_at: string | null;
  created_at: string | null;
};

export type AssetDetailResponse = {
  asset: Record<string, unknown>;
  usage_events: AssetUsageEventDto[];
  related_candidates: Record<string, unknown>[];
  publishing_jobs: Record<string, unknown>[];
};

export type AssetListResponse = {
  items: AssetListRow[];
  next_offset: number | null;
};

export const MANUAL_USAGE_TYPES = ['manual_post', 'manual_story', 'manual_reel'] as const;
export type ManualUsageType = (typeof MANUAL_USAGE_TYPES)[number];
