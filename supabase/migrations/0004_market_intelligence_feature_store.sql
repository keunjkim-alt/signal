begin;

create table if not exists public.market_product_observations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  platform text not null,
  external_product_id text not null,
  observed_date date not null,
  collected_at timestamptz not null,
  url text,
  brand_name text,
  product_name text not null,
  category_path text,
  list_price numeric(14,2),
  sale_price numeric(14,2),
  discount_rate numeric(7,3),
  price_scope text,
  sale_status text,
  rank_value integer,
  rank_type text not null default 'unknown',
  rating numeric(7,3),
  rating_scale text,
  review_count integer,
  row_hash text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id,platform,external_product_id,collected_at,rank_type)
);

create table if not exists public.market_product_daily_metrics (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_date date not null,
  platform text not null,
  external_product_id text not null,
  rank_type text not null default 'unknown',
  brand_name text,
  product_name text not null,
  category_path text,
  url text,
  latest_list_price numeric(14,2),
  latest_sale_price numeric(14,2),
  avg_discount_rate numeric(7,3),
  best_rank integer,
  worst_rank integer,
  latest_rating numeric(7,3),
  latest_review_count integer,
  observation_count integer not null default 0,
  source_watermark timestamptz not null,
  refreshed_at timestamptz not null default now(),
  primary key (organization_id,metric_date,platform,external_product_id,rank_type)
);

create table if not exists public.market_brand_daily_metrics (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_date date not null,
  platform text not null,
  brand_name text not null,
  product_count integer not null default 0,
  top_100_count integer not null default 0,
  best_rank integer,
  avg_rank numeric(10,2),
  avg_discount_rate numeric(7,3),
  avg_rating numeric(7,3),
  total_review_count bigint not null default 0,
  exposure_score numeric(12,2) not null default 0,
  source_watermark timestamptz not null,
  refreshed_at timestamptz not null default now(),
  primary key (organization_id,metric_date,platform,brand_name)
);

create table if not exists public.analysis_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_set text not null,
  subject_type text not null,
  subject_key text not null,
  as_of_date date not null,
  feature_version text not null default 'v1',
  features jsonb not null,
  source_watermark timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,feature_set,subject_type,subject_key,as_of_date,feature_version)
);

create table if not exists public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_metric text not null,
  subject_type text not null,
  subject_key text not null,
  as_of_date date not null,
  horizon_days integer not null check (horizon_days between 1 and 366),
  method text not null,
  model_version text not null,
  predictions jsonb not null,
  confidence numeric(7,4),
  input_watermark timestamptz not null,
  generated_at timestamptz not null default now(),
  unique (organization_id,target_metric,subject_type,subject_key,as_of_date,horizon_days,model_version)
);

create table if not exists public.analytics_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline text not null,
  scope_date date,
  status text not null check (status in ('running','completed','failed')),
  input_rows bigint not null default 0,
  output_rows bigint not null default 0,
  source_watermark timestamptz,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ax_query_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cache_key text not null,
  page_key text not null,
  question_normalized text not null,
  filters jsonb not null default '{}'::jsonb,
  plan_spec jsonb not null,
  result_spec jsonb,
  data_watermark timestamptz,
  model text,
  token_usage jsonb,
  hit_count integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,cache_key)
);

create index if not exists idx_market_observations_lookup on public.market_product_observations(organization_id,observed_date desc,platform,brand_name);
create index if not exists idx_market_observations_rank on public.market_product_observations(organization_id,observed_date desc,rank_value) where rank_value is not null;
create index if not exists idx_market_product_daily_rank on public.market_product_daily_metrics(organization_id,metric_date desc,platform,best_rank);
create index if not exists idx_market_brand_daily_score on public.market_brand_daily_metrics(organization_id,metric_date desc,platform,exposure_score desc);
create index if not exists idx_feature_snapshots_lookup on public.analysis_feature_snapshots(organization_id,feature_set,as_of_date desc,subject_type);
create index if not exists idx_forecast_snapshots_lookup on public.forecast_snapshots(organization_id,target_metric,as_of_date desc,subject_type);
create index if not exists idx_ax_query_cache_expiry on public.ax_query_cache(organization_id,expires_at);

alter table public.market_product_observations enable row level security;
alter table public.market_product_daily_metrics enable row level security;
alter table public.market_brand_daily_metrics enable row level security;
alter table public.analysis_feature_snapshots enable row level security;
alter table public.forecast_snapshots enable row level security;
alter table public.analytics_refresh_runs enable row level security;
alter table public.ax_query_cache enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['market_product_observations','market_product_daily_metrics','market_brand_daily_metrics','analysis_feature_snapshots','forecast_snapshots','analytics_refresh_runs','ax_query_cache']
  loop
    execute format('drop policy if exists %I_member_select on public.%I',table_name,table_name);
    execute format('create policy %I_member_select on public.%I for select using (public.is_org_member(organization_id))',table_name,table_name);
    execute format('drop policy if exists %I_admin_write on public.%I',table_name,table_name);
    execute format('create policy %I_admin_write on public.%I for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id))',table_name,table_name);
  end loop;
end $$;

create or replace function public.refresh_market_daily_analytics(
  p_organization_id uuid,
  p_metric_date date
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_run_id uuid;
  v_input_rows bigint;
  v_product_rows bigint;
  v_brand_rows bigint;
  v_watermark timestamptz;
begin
  if auth.role() <> 'service_role' and not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;

  insert into analytics_refresh_runs(organization_id,pipeline,scope_date,status)
  values(p_organization_id,'market_daily',p_metric_date,'running') returning id into v_run_id;

  select count(*),max(collected_at) into v_input_rows,v_watermark
  from market_product_observations
  where organization_id=p_organization_id and observed_date=p_metric_date;

  insert into market_product_daily_metrics(
    organization_id,metric_date,platform,external_product_id,rank_type,brand_name,product_name,category_path,url,
    latest_list_price,latest_sale_price,avg_discount_rate,best_rank,worst_rank,latest_rating,latest_review_count,
    observation_count,source_watermark,refreshed_at
  )
  select
    organization_id,observed_date,platform,external_product_id,rank_type,
    (array_agg(brand_name order by collected_at desc))[1],
    (array_agg(product_name order by collected_at desc))[1],
    (array_agg(category_path order by collected_at desc))[1],
    (array_agg(url order by collected_at desc))[1],
    (array_agg(list_price order by collected_at desc))[1],
    (array_agg(sale_price order by collected_at desc))[1],
    round(avg(discount_rate)::numeric,3),min(rank_value),max(rank_value),
    (array_agg(rating order by collected_at desc))[1],
    (array_agg(review_count order by collected_at desc))[1],
    count(*)::integer,max(collected_at),now()
  from market_product_observations
  where organization_id=p_organization_id and observed_date=p_metric_date
  group by organization_id,observed_date,platform,external_product_id,rank_type
  on conflict (organization_id,metric_date,platform,external_product_id,rank_type) do update set
    brand_name=excluded.brand_name,product_name=excluded.product_name,category_path=excluded.category_path,url=excluded.url,
    latest_list_price=excluded.latest_list_price,latest_sale_price=excluded.latest_sale_price,
    avg_discount_rate=excluded.avg_discount_rate,best_rank=excluded.best_rank,worst_rank=excluded.worst_rank,
    latest_rating=excluded.latest_rating,latest_review_count=excluded.latest_review_count,
    observation_count=excluded.observation_count,source_watermark=excluded.source_watermark,refreshed_at=now();
  get diagnostics v_product_rows=row_count;

  insert into market_brand_daily_metrics(
    organization_id,metric_date,platform,brand_name,product_count,top_100_count,best_rank,avg_rank,
    avg_discount_rate,avg_rating,total_review_count,exposure_score,source_watermark,refreshed_at
  )
  select organization_id,metric_date,platform,coalesce(nullif(brand_name,''),'브랜드 미상'),count(distinct external_product_id)::integer,
    count(*) filter(where best_rank between 1 and 100)::integer,min(best_rank),round(avg(best_rank)::numeric,2),
    round(avg(avg_discount_rate)::numeric,3),round(avg(latest_rating)::numeric,3),sum(coalesce(latest_review_count,0)),
    round(sum(case when best_rank is null then 0 else 1000.0/(10+best_rank) end)::numeric,2),max(source_watermark),now()
  from market_product_daily_metrics
  where organization_id=p_organization_id and metric_date=p_metric_date
  group by organization_id,metric_date,platform,coalesce(nullif(brand_name,''),'브랜드 미상')
  on conflict (organization_id,metric_date,platform,brand_name) do update set
    product_count=excluded.product_count,top_100_count=excluded.top_100_count,best_rank=excluded.best_rank,
    avg_rank=excluded.avg_rank,avg_discount_rate=excluded.avg_discount_rate,avg_rating=excluded.avg_rating,
    total_review_count=excluded.total_review_count,exposure_score=excluded.exposure_score,
    source_watermark=excluded.source_watermark,refreshed_at=now();
  get diagnostics v_brand_rows=row_count;

  insert into analysis_feature_snapshots(
    organization_id,feature_set,subject_type,subject_key,as_of_date,feature_version,features,source_watermark,expires_at,updated_at
  )
  select organization_id,'market_brand_daily','external_brand',platform||':'||brand_name,metric_date,'v1',
    jsonb_build_object('platform',platform,'brand_name',brand_name,'product_count',product_count,'top_100_count',top_100_count,
      'best_rank',best_rank,'avg_rank',avg_rank,'avg_discount_rate',avg_discount_rate,'avg_rating',avg_rating,
      'total_review_count',total_review_count,'exposure_score',exposure_score),source_watermark,now()+interval '7 days',now()
  from market_brand_daily_metrics where organization_id=p_organization_id and metric_date=p_metric_date
  on conflict (organization_id,feature_set,subject_type,subject_key,as_of_date,feature_version) do update set
    features=excluded.features,source_watermark=excluded.source_watermark,expires_at=excluded.expires_at,updated_at=now();

  update analytics_refresh_runs set status='completed',input_rows=v_input_rows,
    output_rows=v_product_rows+v_brand_rows,source_watermark=v_watermark,completed_at=now()
  where id=v_run_id;
  return jsonb_build_object('run_id',v_run_id,'input_rows',v_input_rows,'product_rows',v_product_rows,'brand_rows',v_brand_rows,'source_watermark',v_watermark);
exception when others then
  update analytics_refresh_runs set status='failed',error_message=sqlerrm,completed_at=now() where id=v_run_id;
  raise;
end $$;

create or replace function public.query_market_dashboard(
  p_organization_id uuid,
  p_page_key text default 'market',
  p_metric text default 'exposure_score',
  p_dimension text default 'brand',
  p_start date default current_date - 7,
  p_end date default current_date,
  p_platform text default null,
  p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare result jsonb; member_role text;
begin
  select role into member_role from organization_memberships
  where organization_id=p_organization_id and user_id=auth.uid() and status='active';
  if member_role is null then raise exception 'not authorized'; end if;
  if member_role not in ('owner','admin') and not exists(
    select 1 from page_permissions pp join organization_memberships m on m.id=pp.membership_id
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and pp.page_key=p_page_key and pp.can_view
  ) then raise exception 'page permission required'; end if;
  if p_metric not in ('exposure_score','best_rank','avg_rank','product_count','top_100_count','avg_discount_rate','avg_rating','total_review_count') then raise exception 'unsupported metric'; end if;
  if p_dimension not in ('brand','platform','day','category','market_product') then raise exception 'unsupported dimension'; end if;

  if p_dimension in ('brand','platform','day') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      select case p_dimension when 'brand' then brand_name when 'platform' then platform else metric_date::text end as label,
        round(sum(exposure_score)::numeric,2) as exposure_score,min(best_rank) as best_rank,round(avg(avg_rank)::numeric,2) as avg_rank,
        sum(product_count)::integer as product_count,sum(top_100_count)::integer as top_100_count,
        round(avg(avg_discount_rate)::numeric,3) as avg_discount_rate,round(avg(avg_rating)::numeric,3) as avg_rating,
        sum(total_review_count) as total_review_count,max(source_watermark) as source_watermark
      from market_brand_daily_metrics
      where organization_id=p_organization_id and metric_date between p_start and p_end and (p_platform is null or platform=p_platform)
      group by label order by
        case p_metric when 'best_rank' then -coalesce(min(best_rank),2147483647) else
          case p_metric when 'exposure_score' then sum(exposure_score) when 'avg_rank' then -coalesce(avg(avg_rank),2147483647)
          when 'product_count' then sum(product_count) when 'top_100_count' then sum(top_100_count)
          when 'avg_discount_rate' then avg(avg_discount_rate) when 'avg_rating' then avg(avg_rating)
          else sum(total_review_count) end end desc nulls last limit least(greatest(p_limit,1),100)
    ) x;
  else
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      select case p_dimension when 'category' then coalesce(category_path,'카테고리 미상') else product_name end as label,
        min(best_rank) as best_rank,round(avg(avg_discount_rate)::numeric,3) as avg_discount_rate,
        round(avg(latest_rating)::numeric,3) as avg_rating,max(latest_review_count) as total_review_count,
        count(distinct external_product_id)::integer as product_count,max(source_watermark) as source_watermark
      from market_product_daily_metrics
      where organization_id=p_organization_id and metric_date between p_start and p_end and (p_platform is null or platform=p_platform)
      group by label order by min(best_rank) asc nulls last limit least(greatest(p_limit,1),100)
    ) x;
  end if;
  return jsonb_build_object('rows',result,'metric',p_metric,'dimension',p_dimension,'source','market_daily_metrics');
end $$;

commit;
