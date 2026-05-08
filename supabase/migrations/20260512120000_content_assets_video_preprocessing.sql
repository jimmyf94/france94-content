-- content_assets: video preprocessing fields (FR94 Content Ops v0.3)

alter table public.content_assets
  add column if not exists duration_seconds numeric,
  add column if not exists video_width integer,
  add column if not exists video_height integer,
  add column if not exists frame_sample_count integer,
  add column if not exists frame_sample_paths text[],
  add column if not exists audio_transcript text,
  add column if not exists analysis_strategy text,
  add column if not exists analysis_confidence numeric,
  add column if not exists needs_full_video_review boolean default false,
  add column if not exists reason_full_video_review_needed text;

create index if not exists idx_content_assets_analysis_strategy
  on public.content_assets (analysis_strategy);

create index if not exists idx_content_assets_needs_full_video_review
  on public.content_assets (needs_full_video_review)
  where needs_full_video_review = true;

comment on column public.content_assets.analysis_strategy is
  'How the asset was analyzed: image_direct, video_frames_only, video_frames_plus_audio, video_full_low_res, audio_only, too_large.';

comment on column public.content_assets.frame_sample_paths is
  'Ephemeral temp filenames of sampled JPEG frames at run time (files are deleted after analysis; stored for audit only).';

comment on column public.content_assets.needs_full_video_review is
  'True when sampled-frame analysis was insufficient and a human or full-video pass is recommended.';
