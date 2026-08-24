begin;

alter table public.data_sources
  add column if not exists data_mode text not null default 'connected',
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists last_sync_error text;

do $$ begin
  alter table public.data_sources add constraint data_sources_data_mode_check check (data_mode in ('sample','connected','stale'));
exception when duplicate_object then null; end $$;

alter table public.raw_uploads
  add column if not exists entity_type text;

create index if not exists raw_uploads_dedupe_idx
  on public.raw_uploads(organization_id,entity_type,checksum,status,created_at desc);

alter table public.import_jobs
  add column if not exists data_source_id uuid references public.data_sources(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists inserted_rows integer not null default 0,
  add column if not exists updated_rows integer not null default 0,
  add column if not exists unchanged_rows integer not null default 0;

alter table public.sales_orders
  add column if not exists raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  add column if not exists import_job_id uuid references public.import_jobs(id) on delete set null,
  add column if not exists source_updated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.sales_order_lines
  add column if not exists source_line_id text,
  add column if not exists raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  add column if not exists import_job_id uuid references public.import_jobs(id) on delete set null,
  add column if not exists source_updated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists sales_order_lines_source_identity_idx
  on public.sales_order_lines(organization_id,order_id,source_line_id);

create index if not exists sales_orders_org_ordered_idx
  on public.sales_orders(organization_id,ordered_at desc);

create index if not exists sales_order_lines_org_sku_idx
  on public.sales_order_lines(organization_id,sku_id);

commit;
