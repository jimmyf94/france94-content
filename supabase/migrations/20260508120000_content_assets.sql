-- content_assets: canonical registry for ingested Drive files (FR94 Content Ops v0.1)

create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),

  drive_file_id text unique not null,
  drive_parent_folder_id text,

  original_filename text not null,
  current_filename text,
  renamed_filename text,

  mime_type text,
  file_extension text,
  file_size bigint,
  checksum text,

  drive_created_time timestamptz,
  drive_modified_time timestamptz,
  imported_at timestamptz default now(),
  updated_at timestamptz default now(),

  media_type text,
  -- image, video, audio, text, other

  source text default 'google_drive',

  status text default 'new',
  -- new, analyzed, renamed, ready_for_planning, used, archived, duplicate, error

  metadata_raw jsonb,
  error_message text
);

create index if not exists idx_content_assets_drive_file_id
  on public.content_assets (drive_file_id);

create index if not exists idx_content_assets_status
  on public.content_assets (status);

create index if not exists idx_content_assets_imported_at
  on public.content_assets (imported_at desc);

create index if not exists idx_content_assets_checksum
  on public.content_assets (checksum)
  where checksum is not null;

alter table public.content_assets enable row level security;

comment on table public.content_assets is 'Ingested media assets; RLS enabled. Policies: see 20260509120000_content_assets_rls_policies.sql. service_role bypasses RLS for ingest.';
