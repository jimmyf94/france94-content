-- content_assets: nonverbal/emotional cues from sampled analysis (FR94 Content Ops v0.4)

alter table public.content_assets
  add column if not exists nonverbal_cues text[];

comment on column public.content_assets.nonverbal_cues is
  'Short list of nonverbal/emotional cues observed in the asset (e.g. laughter, smile, fatigue, shiver, eye-roll). Empty array when none.';
