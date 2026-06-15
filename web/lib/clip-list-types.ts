export type ClipListRow = {
  id: string;
  content_asset_id: string;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  visual_summary: string | null;
  transcript_excerpt: string | null;
  hooks: string[];
  pov_concepts: string[];
  fitting_series_slugs: string[];
  asset_filename: string | null;
  candidate_eligibility: string | null;
  thumbnail_url: string | null;
  asset_thumbnail_url: string | null;
};
