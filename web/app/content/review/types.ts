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
  source_asset_ids?: string[] | null;
  source_drive_file_ids?: string[] | null;
  created_at: string;
  updated_at: string | null;
  llm_model?: string | null;
  llm_raw?: unknown;
  last_regenerated_at?: string | null;
  regeneration_count?: number | null;
};

export type ReviewDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  size: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
};

export type StatusTab = 'needs_review' | 'needs_rewrite' | 'approved' | 'rejected';

export type DetailTab = 'caption' | 'structure' | 'transcript' | 'debug';

export type DecisionStatus = 'approved' | 'rejected' | 'needs_rewrite';

export const STATUS_TAB_LABEL: Record<StatusTab, string> = {
  needs_review: 'Needs review',
  needs_rewrite: 'Needs rewrite',
  approved: 'Approved',
  rejected: 'Rejected',
};
