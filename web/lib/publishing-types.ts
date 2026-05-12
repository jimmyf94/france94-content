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
  error_message: string | null;
};
