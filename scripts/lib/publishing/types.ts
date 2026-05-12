/**
 * Values persisted on `publishing_jobs.publish_type`.
 * Canonical list: Postgres constraint `publishing_jobs_publish_type_check`
 * (see `supabase/migrations/20260511130000_publishing_jobs.sql` and
 * `supabase/migrations/20260518120000_publishing_jobs_publish_type_story_sequence.sql`).
 * Update the migration when adding a new variant, then extend this union.
 */
export type PublishType = 'image' | 'video' | 'carousel' | 'reel' | 'story' | 'story_sequence';

export type PublishingJobStatus =
  | 'draft'
  | 'media_prepared'
  | 'containers_created'
  | 'processing'
  | 'ready_to_publish'
  | 'published'
  | 'failed';

export type PreparedMediaItem = {
  asset_id: string | null;
  drive_file_id: string;
  media_type: 'image' | 'video';
  public_url: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  mime_type: string;
  order: number;
};

/** Row shape for publishing_jobs (camelCase in TS for convenience → snake in DB). */
export type PublishingJobRow = {
  id: string;
  post_candidate_id: string;
  platform: string;
  publish_type: PublishType;
  status: PublishingJobStatus;
  caption: string | null;
  hashtags: string[] | null;
  source_asset_ids: string[];
  source_drive_file_ids: string[];
  prepared_media: PreparedMediaItem[];
  public_media_urls: string[];
  instagram_child_container_ids: string[];
  instagram_parent_container_id: string | null;
  instagram_creation_id: string | null;
  instagram_container_status: string | null;
  instagram_media_id: string | null;
  graph_api_review_url: string | null;
  graph_api_raw: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type PostCandidateRow = {
  id: string;
  post_type: string;
  caption_fr: string | null;
  caption_en: string | null;
  hashtags: string[] | null;
  story_frames: unknown;
  reel_instructions: unknown;
  carousel_slides: unknown;
  static_post_instructions: unknown;
  source_asset_ids: string[] | null;
  source_drive_file_ids: string[] | null;
  status: string;
};

export type ResolvedMediaItem = {
  order: number;
  asset_id: string;
  drive_file_id: string;
  mime_type: string | null;
  media_type: string;
};

export type EligibilityOk = { ok: true; publishType: PublishType };
export type EligibilityFail = { ok: false; reason: string };
export type EligibilityResult = EligibilityOk | EligibilityFail;
