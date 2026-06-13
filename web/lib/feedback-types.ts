export type FeedbackPostRow = {
  id: string;
  postedAt: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  postTypeLabel: string;
  permalink: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  views: number | null;
  shares: number | null;
  avgWatchTimeMs: number | null;
};

export type FeedbackResponse = {
  posts?: FeedbackPostRow[];
  insightsAvailable?: boolean;
  insightsPermissionDenied?: boolean;
  error?: string;
};
