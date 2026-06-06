export type PublishingJobDto = {
  id: string;
  post_candidate_id: string;
  status: string;
  publish_type: string;
  caption: string | null;
  public_media_urls: string[];
  prepared_media: Array<{
    media_type: string;
    public_url: string;
    order: number;
  }>;
  instagram_child_container_ids: string[];
  instagram_parent_container_id: string | null;
  instagram_creation_id: string | null;
  instagram_container_status: string | null;
  instagram_media_id: string | null;
  instagram_permalink: string | null;
  error_message: string | null;
  scheduled_publish_at: string | null;
  published_at: string | null;
  publish_attempt_count: number | null;
  last_publish_attempt_at: string | null;
};

export type PublishingQueueCandidateBrief = {
  id: string;
  title: string | null;
  post_type: string;
  status: string;
  review_drive_folder_url: string | null;
  cover_thumbnail_url: string | null;
  ready_to_publish_at: string | null;
};

export type PublishingQueueItem = {
  id: string;
  post_candidate_id: string;
  status: string;
  publish_type: string;
  scheduled_publish_at: string | null;
  published_at: string | null;
  instagram_permalink: string | null;
  created_at: string;
  thumbnail_url: string | null;
  candidate: PublishingQueueCandidateBrief;
};
