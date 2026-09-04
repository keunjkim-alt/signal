begin;

alter table public.workspaces add column if not exists description text;
alter table public.workspaces add column if not exists image_url text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('workspace-assets','workspace-assets',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists workspace_assets_public_read on storage.objects;
create policy workspace_assets_public_read on storage.objects for select using (bucket_id='workspace-assets');

commit;
