begin;

do $$ begin
  alter table public.mapping_templates drop constraint mapping_templates_entity_type_check;
exception when undefined_object then null; end $$;

alter table public.mapping_templates
  add constraint mapping_templates_entity_type_check
  check (entity_type in ('product_master','inventory_snapshot','inventory_movement','inbound_order','transfer_order','sales_order','product_review'));

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  import_job_id uuid references public.import_jobs(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  sku_id uuid references public.skus(id) on delete set null,
  source_review_id text not null,
  reviewed_at timestamptz not null,
  platform text not null,
  channel_code text,
  product_code text not null,
  sku_code text,
  rating numeric(2,1) not null check (rating between 1 and 5),
  review_text text not null,
  verified_purchase boolean not null default false,
  helpful_count integer not null default 0,
  image_review boolean not null default false,
  customer_token text,
  order_id text,
  country_code text not null default 'KR',
  color text,
  size text,
  seller_response_status text not null default 'pending' check (seller_response_status in ('pending','responded','not_required')),
  language_code text not null default 'ko',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,platform,source_review_id)
);

create table if not exists public.review_aspect_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  review_id uuid not null references public.product_reviews(id) on delete cascade,
  aspect_code text not null,
  aspect_label text not null,
  sentiment text not null check (sentiment in ('positive','neutral','negative')),
  severity integer not null default 0 check (severity between 0 and 3),
  confidence numeric(4,3) not null default .7,
  return_risk boolean not null default false,
  recommended_team text,
  recommended_action text,
  created_at timestamptz not null default now(),
  unique (review_id,aspect_code)
);

create index if not exists idx_product_reviews_org_date on public.product_reviews(organization_id,reviewed_at desc);
create index if not exists idx_product_reviews_product on public.product_reviews(organization_id,product_id,reviewed_at desc);
create index if not exists idx_review_aspects_org_signal on public.review_aspect_signals(organization_id,aspect_code,sentiment);

alter table public.product_reviews enable row level security;
alter table public.review_aspect_signals enable row level security;

drop policy if exists product_reviews_member_select on public.product_reviews;
create policy product_reviews_member_select on public.product_reviews for select using (public.is_org_member(organization_id));
drop policy if exists product_reviews_admin_write on public.product_reviews;
create policy product_reviews_admin_write on public.product_reviews for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
drop policy if exists review_aspect_signals_member_select on public.review_aspect_signals;
create policy review_aspect_signals_member_select on public.review_aspect_signals for select using (public.is_org_member(organization_id));
drop policy if exists review_aspect_signals_admin_write on public.review_aspect_signals;
create policy review_aspect_signals_admin_write on public.review_aspect_signals for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

commit;
