-- content_assets RLS: allow logged-in API clients (authenticated) full CRUD.
-- anon: no policies => no access via PostgREST.
-- service_role: bypasses RLS (ingest script).

create policy "content_assets_select_authenticated"
  on public.content_assets
  for select
  to authenticated
  using (true);

create policy "content_assets_insert_authenticated"
  on public.content_assets
  for insert
  to authenticated
  with check (true);

create policy "content_assets_update_authenticated"
  on public.content_assets
  for update
  to authenticated
  using (true)
  with check (true);

create policy "content_assets_delete_authenticated"
  on public.content_assets
  for delete
  to authenticated
  using (true);

comment on table public.content_assets is
  'Ingested media assets. RLS: authenticated may CRUD all rows; anon has no access; service_role bypasses RLS for backend ingest.';
