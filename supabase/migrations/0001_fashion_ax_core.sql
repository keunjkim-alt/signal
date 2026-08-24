begin;

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended','trial')),
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  country_code text not null default 'KR',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'ko-KR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','member','viewer')),
  team_code text,
  status text not null default 'active' check (status in ('invited','active','disabled')),
  data_scope jsonb not null default '{"brands":"all","countries":"all","channels":"all","locations":"all"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.page_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  page_key text not null,
  can_view boolean not null default true,
  can_update boolean not null default false,
  can_approve boolean not null default false,
  data_scope jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (membership_id, page_key)
);

create table if not exists public.data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  source_type text not null check (source_type in ('wms','erp','pos','commerce','sheet','file','sftp','api')),
  provider text not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','error','paused')),
  sync_mode text not null default 'manual' check (sync_mode in ('manual','scheduled','realtime')),
  schedule text,
  config jsonb not null default '{}'::jsonb,
  secret_ref text,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mapping_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete cascade,
  name text not null,
  entity_type text not null check (entity_type in ('inventory_snapshot','inventory_movement','inbound_order','transfer_order','sales_order')),
  header_signature text,
  mapping jsonb not null,
  transformations jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.raw_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  uploaded_by uuid not null references auth.users(id),
  original_filename text not null,
  storage_path text not null,
  content_type text,
  byte_size bigint not null default 0,
  checksum text,
  status text not null default 'uploaded' check (status in ('uploaded','processing','completed','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  mapping_template_id uuid references public.mapping_templates(id) on delete set null,
  entity_type text not null,
  status text not null default 'queued' check (status in ('queued','validating','processing','completed','failed','partial')),
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  error_rows integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.import_errors (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  row_number integer,
  field_name text,
  error_code text not null,
  message text not null,
  raw_row jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  product_code text not null,
  product_name text not null,
  category_l1 text,
  category_l2 text,
  season text,
  image_url text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code)
);

create table if not exists public.skus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  sku_code text not null,
  barcode text,
  color text,
  size text,
  external_codes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku_code)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  location_code text not null,
  location_name text not null,
  location_type text not null check (location_type in ('warehouse','store','online_dc','factory','in_transit')),
  country_code text not null default 'KR',
  region text,
  timezone text not null default 'Asia/Seoul',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, location_code)
);

create table if not exists public.inventory_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,
  sku_id uuid not null references public.skus(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  snapshot_at timestamptz not null,
  on_hand_qty numeric(16,3) not null default 0,
  reserved_qty numeric(16,3) not null default 0,
  available_qty numeric(16,3) not null default 0,
  in_transit_qty numeric(16,3) not null default 0,
  damaged_qty numeric(16,3) not null default 0,
  safety_stock_qty numeric(16,3) not null default 0,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, sku_id, location_id, snapshot_at)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,
  source_movement_id text,
  sku_id uuid not null references public.skus(id) on delete cascade,
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  movement_type text not null,
  quantity numeric(16,3) not null,
  occurred_at timestamptz not null,
  status text,
  reference_no text,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, source_id, source_movement_id)
);

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,
  source_order_id text not null,
  channel_code text not null,
  location_id uuid references public.locations(id),
  ordered_at timestamptz not null,
  status text not null,
  country_code text not null default 'KR',
  currency_code text not null default 'KRW',
  gross_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  customer_token text,
  shipping_region_1 text,
  shipping_region_2 text,
  created_at timestamptz not null default now(),
  unique (organization_id, source_id, source_order_id)
);

create table if not exists public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  sku_id uuid references public.skus(id),
  product_id uuid references public.products(id),
  quantity numeric(16,3) not null default 0,
  returned_quantity numeric(16,3) not null default 0,
  unit_list_price numeric(18,2) not null default 0,
  unit_sale_price numeric(18,2) not null default 0,
  net_sales numeric(18,2) not null default 0,
  unit_cost numeric(18,2) not null default 0,
  channel_fee numeric(18,2) not null default 0,
  marketing_cost numeric(18,2) not null default 0,
  shipping_cost numeric(18,2) not null default 0,
  return_cost numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.transfer_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku_id uuid not null references public.skus(id),
  from_location_id uuid not null references public.locations(id),
  to_location_id uuid not null references public.locations(id),
  recommended_qty numeric(16,3),
  approved_qty numeric(16,3),
  status text not null default 'recommended',
  reason jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.dashboard_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  team_code text,
  name text not null,
  page_key text not null,
  visibility text not null default 'private' check (visibility in ('private','team','organization')),
  query_spec jsonb not null,
  visualization_spec jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_membership_user on public.organization_memberships(user_id, status);
create index if not exists idx_sources_org on public.data_sources(organization_id, status);
create index if not exists idx_snapshots_lookup on public.inventory_snapshots(organization_id, snapshot_at desc, location_id, sku_id);
create index if not exists idx_movements_lookup on public.inventory_movements(organization_id, occurred_at desc, sku_id);
create index if not exists idx_orders_lookup on public.sales_orders(organization_id, ordered_at desc, channel_code);
create index if not exists idx_order_lines_order on public.sales_order_lines(order_id);
create index if not exists idx_audit_org on public.audit_logs(organization_id, created_at desc);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organization_memberships m where m.organization_id=target_org and m.user_id=auth.uid() and m.status='active') $$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organization_memberships m where m.organization_id=target_org and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin')) $$;

alter table public.organizations enable row level security;
alter table public.brands enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.page_permissions enable row level security;
alter table public.data_sources enable row level security;
alter table public.mapping_templates enable row level security;
alter table public.raw_uploads enable row level security;
alter table public.import_jobs enable row level security;
alter table public.import_errors enable row level security;
alter table public.products enable row level security;
alter table public.skus enable row level security;
alter table public.locations enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
alter table public.transfer_orders enable row level security;
alter table public.dashboard_views enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations for select using (public.is_org_member(id));
create policy brands_member on public.brands for select using (public.is_org_member(organization_id));
create policy profiles_self on public.profiles for select using (user_id=auth.uid());
create policy memberships_member on public.organization_memberships for select using (public.is_org_member(organization_id));
create policy memberships_admin_write on public.organization_memberships for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

do $$
declare table_name text;
begin
  foreach table_name in array array['page_permissions','data_sources','mapping_templates','raw_uploads','import_jobs','import_errors','products','skus','locations','inventory_snapshots','inventory_movements','sales_orders','sales_order_lines','transfer_orders','dashboard_views','audit_logs']
  loop
    execute format('create policy %I_member_select on public.%I for select using (public.is_org_member(organization_id))',table_name,table_name);
    execute format('create policy %I_admin_write on public.%I for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id))',table_name,table_name);
  end loop;
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('raw-imports','raw-imports',false,20971520,array['text/csv','application/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy raw_imports_read on storage.objects for select to authenticated
using (bucket_id='raw-imports' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy raw_imports_insert on storage.objects for insert to authenticated
with check (bucket_id='raw-imports' and public.is_org_member(((storage.foldername(name))[1])::uuid));

create or replace function public.query_sales_dashboard(
  p_organization_id uuid,
  p_page_key text default 'hub',
  p_metric text default 'net_sales',
  p_dimension text default 'channel',
  p_start timestamptz default now() - interval '7 days',
  p_end timestamptz default now(),
  p_countries text[] default null,
  p_channels text[] default null,
  p_locations text[] default null
) returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  result jsonb;
  member_role text;
  member_scope jsonb;
  allowed_countries text[];
  allowed_channels text[];
  allowed_locations text[];
begin
  select m.role,m.data_scope into member_role,member_scope from organization_memberships m
  where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active';
  if member_role is null then raise exception 'not authorized'; end if;
  if member_role not in ('owner','admin') and not exists(
    select 1 from page_permissions pp join organization_memberships m on m.id=pp.membership_id
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and pp.page_key=p_page_key and pp.can_view
  ) then raise exception 'page permission required'; end if;
  if coalesce(member_scope->>'countries','all')<>'all' then
    select array_agg(value) into allowed_countries from jsonb_array_elements_text(member_scope->'countries');
    if p_countries is null then p_countries:=allowed_countries;
    elsif exists(select 1 from unnest(p_countries) value where not value=any(allowed_countries)) then raise exception 'country scope exceeded'; end if;
  end if;
  if coalesce(member_scope->>'channels','all')<>'all' then
    select array_agg(value) into allowed_channels from jsonb_array_elements_text(member_scope->'channels');
    if p_channels is null then p_channels:=allowed_channels;
    elsif exists(select 1 from unnest(p_channels) value where not value=any(allowed_channels)) then raise exception 'channel scope exceeded'; end if;
  end if;
  if coalesce(member_scope->>'locations','all')<>'all' then
    select array_agg(value) into allowed_locations from jsonb_array_elements_text(member_scope->'locations');
    if p_locations is null then p_locations:=allowed_locations;
    elsif exists(select 1 from unnest(p_locations) value where not value=any(allowed_locations)) then raise exception 'location scope exceeded'; end if;
  end if;
  if p_dimension not in ('channel','location','product','day') then raise exception 'unsupported dimension'; end if;
  if p_metric not in ('net_sales','quantity','orders','available_qty','inventory_cover_days','contribution_margin','return_rate','sell_through_rate') then raise exception 'unsupported metric'; end if;
  if p_metric in ('available_qty','inventory_cover_days','sell_through_rate') and p_dimension='location' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      with latest as (
        select distinct on (i.sku_id,i.location_id) i.sku_id,i.location_id,i.available_qty
        from inventory_snapshots i where i.organization_id=p_organization_id and i.snapshot_at<p_end
        order by i.sku_id,i.location_id,i.snapshot_at desc
      ), velocity as (
        select l.sku_id,o.location_id,sum(l.quantity) as sold,sum(l.quantity)/greatest(extract(epoch from (p_end-p_start))/86400,1) as daily_sales
        from sales_orders o join sales_order_lines l on l.order_id=o.id
        where o.organization_id=p_organization_id and o.ordered_at>=p_start and o.ordered_at<p_end
          and (p_countries is null or o.country_code=any(p_countries)) and (p_channels is null or o.channel_code=any(p_channels))
        group by l.sku_id,o.location_id
      )
      select loc.location_name as label,sum(i.available_qty) as available_qty,
        round((sum(i.available_qty)/nullif(sum(coalesce(v.daily_sales,0)),0))::numeric,1) as inventory_cover_days,
        round((sum(coalesce(v.sold,0))/nullif(sum(coalesce(v.sold,0))+sum(i.available_qty),0)*100)::numeric,1) as sell_through_rate
      from latest i join locations loc on loc.id=i.location_id left join velocity v on v.sku_id=i.sku_id and v.location_id=i.location_id
      where (p_locations is null or loc.location_code=any(p_locations)) and (p_countries is null or loc.country_code=any(p_countries))
      group by loc.location_name order by available_qty desc
    ) x;
  elsif p_metric in ('available_qty','inventory_cover_days','sell_through_rate') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      with latest as (
        select distinct on (i.sku_id,i.location_id) i.sku_id,i.location_id,i.available_qty
        from inventory_snapshots i where i.organization_id=p_organization_id and i.snapshot_at<p_end
        order by i.sku_id,i.location_id,i.snapshot_at desc
      ), inventory_by_sku as (
        select i.sku_id,sum(i.available_qty) as available_qty from latest i join locations loc on loc.id=i.location_id
        where (p_locations is null or loc.location_code=any(p_locations)) and (p_countries is null or loc.country_code=any(p_countries)) group by i.sku_id
      ), velocity as (
        select l.sku_id,sum(l.quantity) as sold,sum(l.quantity)/greatest(extract(epoch from (p_end-p_start))/86400,1) as daily_sales
        from sales_orders o join sales_order_lines l on l.order_id=o.id
        where o.organization_id=p_organization_id and o.ordered_at>=p_start and o.ordered_at<p_end
          and (p_countries is null or o.country_code=any(p_countries)) and (p_channels is null or o.channel_code=any(p_channels))
        group by l.sku_id
      )
      select coalesce(p.product_name,s.sku_code) as label,p.image_url,sum(i.available_qty) as available_qty,
        round((sum(i.available_qty)/nullif(sum(coalesce(v.daily_sales,0)),0))::numeric,1) as inventory_cover_days,
        round((sum(coalesce(v.sold,0))/nullif(sum(coalesce(v.sold,0))+sum(i.available_qty),0)*100)::numeric,1) as sell_through_rate
      from inventory_by_sku i join skus s on s.id=i.sku_id left join products p on p.id=s.product_id left join velocity v on v.sku_id=i.sku_id
      group by coalesce(p.product_name,s.sku_code),p.image_url order by available_qty desc
    ) x;
  elsif p_dimension='channel' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      select o.channel_code as label,sum(l.net_sales) as net_sales,sum(l.quantity) as quantity,count(distinct o.id) as orders,
        sum(l.net_sales-l.unit_cost*l.quantity-l.channel_fee-l.marketing_cost-l.shipping_cost-l.return_cost) as contribution_margin,
        round((sum(l.returned_quantity)/nullif(sum(l.quantity),0)*100)::numeric,1) as return_rate
      from sales_orders o join sales_order_lines l on l.order_id=o.id
      where o.organization_id=p_organization_id and o.ordered_at>=p_start and o.ordered_at<p_end
        and (p_countries is null or o.country_code=any(p_countries)) and (p_channels is null or o.channel_code=any(p_channels))
        and (p_locations is null or exists(select 1 from locations scope_loc where scope_loc.id=o.location_id and scope_loc.location_code=any(p_locations)))
      group by o.channel_code order by net_sales desc
    ) x;
  elsif p_dimension='location' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      select coalesce(loc.location_name,'온라인') as label,sum(l.net_sales) as net_sales,sum(l.quantity) as quantity,count(distinct o.id) as orders,
        sum(l.net_sales-l.unit_cost*l.quantity-l.channel_fee-l.marketing_cost-l.shipping_cost-l.return_cost) as contribution_margin,
        round((sum(l.returned_quantity)/nullif(sum(l.quantity),0)*100)::numeric,1) as return_rate
      from sales_orders o join sales_order_lines l on l.order_id=o.id left join locations loc on loc.id=o.location_id
      where o.organization_id=p_organization_id and o.ordered_at>=p_start and o.ordered_at<p_end
        and (p_countries is null or o.country_code=any(p_countries)) and (p_channels is null or o.channel_code=any(p_channels))
        and (p_locations is null or exists(select 1 from locations scope_loc where scope_loc.id=o.location_id and scope_loc.location_code=any(p_locations)))
      group by coalesce(loc.location_name,'온라인') order by net_sales desc
    ) x;
  elsif p_dimension='product' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      select coalesce(p.product_name,s.sku_code) as label,p.image_url,sum(l.net_sales) as net_sales,sum(l.quantity) as quantity,count(distinct o.id) as orders,
        sum(l.net_sales-l.unit_cost*l.quantity-l.channel_fee-l.marketing_cost-l.shipping_cost-l.return_cost) as contribution_margin,
        round((sum(l.returned_quantity)/nullif(sum(l.quantity),0)*100)::numeric,1) as return_rate
      from sales_orders o join sales_order_lines l on l.order_id=o.id left join skus s on s.id=l.sku_id left join products p on p.id=l.product_id
      where o.organization_id=p_organization_id and o.ordered_at>=p_start and o.ordered_at<p_end
        and (p_countries is null or o.country_code=any(p_countries)) and (p_channels is null or o.channel_code=any(p_channels))
        and (p_locations is null or exists(select 1 from locations scope_loc where scope_loc.id=o.location_id and scope_loc.location_code=any(p_locations)))
      group by coalesce(p.product_name,s.sku_code),p.image_url order by net_sales desc
    ) x;
  else
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      select date_trunc('day',o.ordered_at) as label,sum(l.net_sales) as net_sales,sum(l.quantity) as quantity,count(distinct o.id) as orders,
        sum(l.net_sales-l.unit_cost*l.quantity-l.channel_fee-l.marketing_cost-l.shipping_cost-l.return_cost) as contribution_margin,
        round((sum(l.returned_quantity)/nullif(sum(l.quantity),0)*100)::numeric,1) as return_rate
      from sales_orders o join sales_order_lines l on l.order_id=o.id
      where o.organization_id=p_organization_id and o.ordered_at>=p_start and o.ordered_at<p_end
        and (p_countries is null or o.country_code=any(p_countries)) and (p_channels is null or o.channel_code=any(p_channels))
        and (p_locations is null or exists(select 1 from locations scope_loc where scope_loc.id=o.location_id and scope_loc.location_code=any(p_locations)))
      group by date_trunc('day',o.ordered_at) order by label
    ) x;
  end if;
  return jsonb_build_object('dimension',p_dimension,'rows',result,'generated_at',now());
end $$;

commit;
