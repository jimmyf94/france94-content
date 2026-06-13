export type ReelReasoning = {
  why_script_works?: string;
  why_clips_support_script?: string;
  emotional_contrast?: string;
  scroll_stop?: string;
  series_fit?: string;
  clips_vs_alternatives?: string;
};

export const REEL_VARIANT_KINDS = [
  'different_pov',
  'different_clip_order',
  'different_hook',
  'different_series',
] as const;

export type ReelVariantKind = (typeof REEL_VARIANT_KINDS)[number];

export const REEL_VARIANT_LABELS: Record<ReelVariantKind, string> = {
  different_pov: 'A · Different POV',
  different_clip_order: 'B · Clip order',
  different_hook: 'C · Different hook',
  different_series: 'D · Different series',
};

export type PostCandidate = {
  id: string;
  candidate_date: string | null;
  platform: string | null;
  post_type: string;
  title: string | null;
  hook: string | null;
  concept_summary: string | null;
  rationale: string | null;
  caption_fr: string | null;
  caption_en: string | null;
  hashtags: string[] | null;
  story_frames: unknown;
  reel_instructions: unknown;
  carousel_slides: unknown;
  static_post_instructions: unknown;
  priority_score: number | null;
  mission_score: number | null;
  human_score: number | null;
  sponsor_safety_score: number | null;
  effort_score: number | null;
  status: string;
  reviewer_notes: string | null;
  review_drive_folder_id: string | null;
  review_drive_folder_url: string | null;
  cover_thumbnail_url?: string | null;
  source_asset_ids?: string[] | null;
  source_drive_file_ids?: string[] | null;
  publishing_job_id?: string | null;
  ready_to_publish_at?: string | null;
  created_at: string;
  updated_at: string | null;
  llm_model?: string | null;
  llm_raw?: unknown;
  last_regenerated_at?: string | null;
  regeneration_count?: number | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  previous_versions?: unknown;
  invalidated_at?: string | null;
  invalidation_reason?: string | null;
  has_asset_conflict?: boolean | null;
  asset_conflict_summary?: string | null;
  freshness_warning?: string | null;
  is_fresh_story?: boolean | null;
  selected_series?: string | null;
  selected_clip_ids?: string[] | null;
  reel_reasoning?: ReelReasoning | null;
  variant_of?: string | null;
  variant_kind?: ReelVariantKind | null;
  narrative_function?: string | null;
  title_overlay?: string | null;
  collision_risk?: string | null;
  collision_summary?: string | null;
  collision_details?: unknown;
  collision_overridden_by?: string | null;
  collision_overridden_at?: string | null;
  cooldown_until?: string | null;
};

/** Row shape from `GET /api/content-review/candidates` (no heavy JSONB). */
export type CandidateListItem = Omit<
  PostCandidate,
  | 'story_frames'
  | 'reel_instructions'
  | 'carousel_slides'
  | 'static_post_instructions'
  | 'llm_raw'
  | 'previous_versions'
>;

export function toCandidateListItem(c: PostCandidate): CandidateListItem {
  const {
    story_frames: _sf,
    reel_instructions: _ri,
    carousel_slides: _cs,
    static_post_instructions: _si,
    llm_raw: _lr,
    previous_versions: _pv,
    ...rest
  } = c;
  return rest;
}

export type ReviewDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string | null;
  /** Same-origin ffmpeg poster when Drive has no thumbnailLink (videos). */
  posterUrl?: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  size: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  /** Resolved from source_asset_ids when listing carousel review media. */
  sourceAssetId?: string | null;
};

export type StatusTab =
  | 'needs_review'
  | 'needs_rewrite'
  | 'approved'
  | 'ready_to_publish'
  | 'rejected';

export type DetailTab = 'caption' | 'structure' | 'transcript' | 'debug';

export type DecisionStatus = 'approved' | 'rejected' | 'needs_rewrite';

export const STATUS_TAB_LABEL: Record<StatusTab, string> = {
  needs_review: 'Needs review',
  needs_rewrite: 'Needs rewrite',
  approved: 'Approved',
  ready_to_publish: 'Ready to publish',
  rejected: 'Rejected',
};
