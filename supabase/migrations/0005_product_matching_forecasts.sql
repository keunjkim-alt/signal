begin;

create table if not exists public.product_market_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  platform text not null,
  external_product_id text not null,
  external_metric_date date not null,
  external_brand_name text,
  external_product_name text not null,
  external_category_path text,
  external_url text,
  match_status text not null default 'suggested' check (match_status in ('suggested','confirmed','rejected')),
  match_method text not null default 'rules_v1',
  similarity_score numeric(7,4) not null check (similarity_score between 0 and 1),
  score_components jsonb not null default '{}'::jsonb,
  rationale text,
  source_watermark timestamptz not null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,product_id,platform,external_product_id)
);

create index if not exists idx_product_market_matches_product
  on public.product_market_matches(organization_id,product_id,match_status,similarity_score desc);
create index if not exists idx_product_market_matches_external
  on public.product_market_matches(organization_id,platform,external_product_id);

alter table public.product_market_matches enable row level security;
drop policy if exists product_market_matches_member_select on public.product_market_matches;
create policy product_market_matches_member_select on public.product_market_matches
  for select using (public.is_org_member(organization_id));
drop policy if exists product_market_matches_admin_write on public.product_market_matches;
create policy product_market_matches_admin_write on public.product_market_matches
  for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create or replace function public.fashion_style_family(p_name text,p_category text)
returns text language sql immutable parallel safe
as $$
  select case
    when lower(coalesce(p_name,'')||' '||coalesce(p_category,'')) ~ '(jacket|jumper|blouson|blazer|coat|outer|트렌치|재킷|자켓|점퍼|블루종|블레이저|코트|아우터)' then 'OUTER'
    when lower(coalesce(p_name,'')||' '||coalesce(p_category,'')) ~ '(pants|trouser|slacks|jogger|denim|jeans|bottom|팬츠|바지|슬랙스|조거|데님)' then 'BOTTOM'
    when lower(coalesce(p_name,'')||' '||coalesce(p_category,'')) ~ '(dress|onepiece|원피스|드레스)' then 'DRESS'
    when lower(coalesce(p_name,'')||' '||coalesce(p_category,'')) ~ '(skirt|스커트|치마)' then 'SKIRT'
    when lower(coalesce(p_name,'')||' '||coalesce(p_category,'')) ~ '(shirt|blouse|tee|t-shirt|top|knit|sweater|cardigan|셔츠|블라우스|티셔츠|상의|니트|가디건)' then 'TOP'
    else 'OTHER'
  end
$$;

create or replace function public.refresh_product_market_matches(
  p_organization_id uuid,
  p_as_of_date date default current_date,
  p_limit_per_product integer default 5
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_run_id uuid;
  v_rows bigint:=0;
  v_watermark timestamptz;
begin
  if auth.role() <> 'service_role' and not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  insert into analytics_refresh_runs(organization_id,pipeline,scope_date,status)
  values(p_organization_id,'product_market_matching',p_as_of_date,'running') returning id into v_run_id;

  select max(source_watermark) into v_watermark
  from market_product_daily_metrics
  where organization_id=p_organization_id and metric_date<=p_as_of_date;

  with internal_product as (
    select p.id,p.product_name,p.category_l1,public.fashion_style_family(p.product_name,p.category_l1) style_family,
      avg(nullif(l.unit_list_price,0)) typical_price
    from products p
    left join sales_order_lines l on l.product_id=p.id and l.organization_id=p.organization_id
    where p.organization_id=p_organization_id
    group by p.id,p.product_name,p.category_l1
  ), latest_external as (
    select distinct on (m.platform,m.external_product_id)
      m.platform,m.external_product_id,m.metric_date,m.brand_name,m.product_name,m.category_path,m.url,
      m.latest_list_price,m.latest_sale_price,m.best_rank,m.latest_review_count,m.source_watermark,
      public.fashion_style_family(m.product_name,m.category_path) style_family
    from market_product_daily_metrics m
    where m.organization_id=p_organization_id and m.metric_date<=p_as_of_date
    order by m.platform,m.external_product_id,m.metric_date desc,m.best_rank nulls last
  ), candidates as (
    select i.id product_id,e.*,
      case when i.style_family=e.style_family and i.style_family<>'OTHER' then .55 else 0 end style_score,
      case when i.typical_price is null or coalesce(e.latest_sale_price,e.latest_list_price) is null then .08
        else greatest(0,1-abs(i.typical_price-coalesce(e.latest_sale_price,e.latest_list_price))/greatest(i.typical_price,1))*.20 end price_score,
      case when e.best_rank is null then 0 else greatest(0,1-least(e.best_rank,1000)/1000.0)*.15 end rank_score,
      least(1,ln(coalesce(e.latest_review_count,0)+1)/ln(10001))*.10 review_score
    from internal_product i cross join latest_external e
    where i.style_family=e.style_family and i.style_family<>'OTHER'
  ), ranked as (
    select c.*,row_number() over(partition by product_id order by
      (style_score+price_score+rank_score+review_score) desc,best_rank asc nulls last) candidate_rank
    from candidates c
  )
  insert into product_market_matches(
    organization_id,product_id,platform,external_product_id,external_metric_date,external_brand_name,
    external_product_name,external_category_path,external_url,match_status,match_method,similarity_score,
    score_components,rationale,source_watermark,updated_at
  )
  select p_organization_id,product_id,platform,external_product_id,metric_date,brand_name,product_name,
    category_path,url,'suggested','rules_v1',round((style_score+price_score+rank_score+review_score)::numeric,4),
    jsonb_build_object('style',round(style_score::numeric,4),'price',round(price_score::numeric,4),
      'rank',round(rank_score::numeric,4),'review',round(review_score::numeric,4),'candidate_rank',candidate_rank),
    '스타일 유형, 가격대, 플랫폼 순위와 리뷰 신호를 결합한 자동 추천',source_watermark,now()
  from ranked where candidate_rank<=least(greatest(p_limit_per_product,1),20)
  on conflict (organization_id,product_id,platform,external_product_id) do update set
    external_metric_date=excluded.external_metric_date,external_brand_name=excluded.external_brand_name,
    external_product_name=excluded.external_product_name,external_category_path=excluded.external_category_path,
    external_url=excluded.external_url,match_method=excluded.match_method,similarity_score=excluded.similarity_score,
    score_components=excluded.score_components,rationale=excluded.rationale,
    source_watermark=excluded.source_watermark,updated_at=now()
  where product_market_matches.match_status='suggested';
  get diagnostics v_rows=row_count;

  update analytics_refresh_runs set status='completed',output_rows=v_rows,source_watermark=v_watermark,completed_at=now()
  where id=v_run_id;
  return jsonb_build_object('run_id',v_run_id,'matched_rows',v_rows,'source_watermark',v_watermark);
exception when others then
  update analytics_refresh_runs set status='failed',error_message=sqlerrm,completed_at=now() where id=v_run_id;
  raise;
end $$;

create or replace function public.refresh_sales_forecasts(
  p_organization_id uuid,
  p_as_of_date date default current_date,
  p_horizon_days integer default 14
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_run_id uuid;
  v_rows bigint:=0;
  v_watermark timestamptz;
begin
  if auth.role() <> 'service_role' and not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if p_horizon_days<1 or p_horizon_days>90 then raise exception 'horizon must be between 1 and 90 days'; end if;
  insert into analytics_refresh_runs(organization_id,pipeline,scope_date,status)
  values(p_organization_id,'sales_forecast',p_as_of_date,'running') returning id into v_run_id;

  select greatest(
    coalesce((select max(o.ordered_at) from sales_orders o where o.organization_id=p_organization_id),'-infinity'::timestamptz),
    coalesce((select max(i.snapshot_at) from inventory_snapshots i where i.organization_id=p_organization_id),'-infinity'::timestamptz)
  ) into v_watermark;

  with recursive calendar as (
    select (p_as_of_date-27)::date sales_date
    union all select sales_date+1 from calendar where sales_date<p_as_of_date
  ), product_days as (
    select p.id product_id,p.product_code,p.product_name,c.sales_date
    from products p cross join calendar c where p.organization_id=p_organization_id
  ), sales_by_day as (
    select l.product_id,o.ordered_at::date sales_date,sum(l.quantity)::numeric qty,sum(l.net_sales)::numeric net_sales
    from sales_orders o join sales_order_lines l on l.order_id=o.id
    where o.organization_id=p_organization_id and o.ordered_at>=p_as_of_date-27 and o.ordered_at<p_as_of_date+1
    group by l.product_id,o.ordered_at::date
  ), daily as (
    select pd.product_id,pd.product_code,pd.product_name,pd.sales_date,
      coalesce(s.qty,0)::numeric qty,coalesce(s.net_sales,0)::numeric net_sales
    from product_days pd left join sales_by_day s on s.product_id=pd.product_id and s.sales_date=pd.sales_date
  ), stats as (
    select product_id,product_code,product_name,
      avg(qty) filter(where sales_date>p_as_of_date-7) avg_7d,
      avg(qty) filter(where sales_date between p_as_of_date-13 and p_as_of_date-7) avg_prior_7d,
      avg(qty) avg_28d,stddev_samp(qty) stddev_28d,
      sum(net_sales)/nullif(sum(qty),0) avg_unit_revenue,count(*) filter(where qty>0) active_days
    from daily group by product_id,product_code,product_name
  ), latest_inventory as (
    select product_id,sum(available_qty) available_qty,sum(safety_stock_qty) safety_stock_qty
    from (
      select distinct on (s.product_id,i.sku_id,i.location_id) s.product_id,i.sku_id,i.location_id,i.available_qty,i.safety_stock_qty
      from inventory_snapshots i join skus s on s.id=i.sku_id
      where i.organization_id=p_organization_id and i.snapshot_at<p_as_of_date+1
      order by s.product_id,i.sku_id,i.location_id,i.snapshot_at desc
    ) x group by product_id
  ), scored as (
    select s.*,coalesce(i.available_qty,0) available_qty,coalesce(i.safety_stock_qty,0) safety_stock_qty,
      greatest(0,coalesce(s.avg_7d,0)*.60+coalesce(s.avg_prior_7d,0)*.25+coalesce(s.avg_28d,0)*.15) daily_forecast,
      least(.95,greatest(.50,(active_days/28.0)*.55 +
        (1-least(1,coalesce(stddev_28d,0)/greatest(coalesce(avg_28d,0),1)))*.40)) confidence_score
    from stats s left join latest_inventory i on i.product_id=s.product_id
  )
  insert into forecast_snapshots(
    organization_id,target_metric,subject_type,subject_key,as_of_date,horizon_days,method,model_version,
    predictions,confidence,input_watermark,generated_at
  )
  select p_organization_id,'quantity','product',product_id::text,p_as_of_date,p_horizon_days,
    'weighted_velocity','sales_weighted_velocity_v1',
    jsonb_build_object(
      'product_id',product_id,'product_code',product_code,'product_name',product_name,
      'daily_quantity',round(daily_forecast,2),'forecast_quantity',round(daily_forecast*p_horizon_days,0),
      'forecast_net_sales',round(daily_forecast*p_horizon_days*coalesce(avg_unit_revenue,0),0),
      'lower_quantity',round(greatest(0,daily_forecast*p_horizon_days-coalesce(stddev_28d,0)*sqrt(p_horizon_days::numeric)),0),
      'upper_quantity',round(daily_forecast*p_horizon_days+coalesce(stddev_28d,0)*sqrt(p_horizon_days::numeric),0),
      'available_qty',round(available_qty,0),'safety_stock_qty',round(safety_stock_qty,0),
      'inventory_cover_days',case when daily_forecast>0 then round(available_qty/daily_forecast,1) else null end,
      'recommended_reorder_qty',round(greatest(0,daily_forecast*p_horizon_days+safety_stock_qty-available_qty),0),
      'history_days',28,'method_note','최근 7일 60% + 이전 7일 25% + 최근 28일 15% 가중 판매속도'
    ),round(confidence_score::numeric,4),v_watermark,now()
  from scored
  on conflict (organization_id,target_metric,subject_type,subject_key,as_of_date,horizon_days,model_version) do update set
    predictions=excluded.predictions,confidence=excluded.confidence,input_watermark=excluded.input_watermark,generated_at=now();
  get diagnostics v_rows=row_count;

  update analytics_refresh_runs set status='completed',output_rows=v_rows,source_watermark=v_watermark,completed_at=now()
  where id=v_run_id;
  return jsonb_build_object('run_id',v_run_id,'forecast_rows',v_rows,'source_watermark',v_watermark);
exception when others then
  update analytics_refresh_runs set status='failed',error_message=sqlerrm,completed_at=now() where id=v_run_id;
  raise;
end $$;

create or replace function public.query_product_intelligence(
  p_organization_id uuid,
  p_page_key text default 'market',
  p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  v_role text;
  v_matches jsonb;
  v_forecasts jsonb;
begin
  select role into v_role from organization_memberships
  where organization_id=p_organization_id and user_id=auth.uid() and status='active';
  if v_role is null then raise exception 'not authorized'; end if;
  if v_role not in ('owner','admin') and not exists(
    select 1 from page_permissions pp join organization_memberships m on m.id=pp.membership_id
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and pp.page_key=p_page_key and pp.can_view
  ) then raise exception 'page permission required'; end if;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_matches from (
    select m.id match_id,p.product_code,p.product_name,p.image_url,m.platform,m.external_brand_name,m.external_product_name,
      m.external_url,m.similarity_score,m.match_status,m.score_components,m.external_metric_date,m.source_watermark
    from product_market_matches m join products p on p.id=m.product_id
    where m.organization_id=p_organization_id and m.match_status<>'rejected'
    order by m.similarity_score desc,m.external_metric_date desc
    limit least(greatest(p_limit,1),100)
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_forecasts from (
    select f.predictions->>'product_code' product_code,f.predictions->>'product_name' product_name,p.image_url,
      (f.predictions->>'forecast_quantity')::numeric forecast_quantity,
      (f.predictions->>'forecast_net_sales')::numeric forecast_net_sales,
      (f.predictions->>'inventory_cover_days')::numeric inventory_cover_days,
      (f.predictions->>'recommended_reorder_qty')::numeric recommended_reorder_qty,
      (f.predictions->>'available_qty')::numeric available_qty,f.confidence,f.as_of_date,f.horizon_days,f.method,f.model_version
    from forecast_snapshots f left join products p on p.id::text=f.subject_key
    where f.organization_id=p_organization_id and f.target_metric='quantity' and f.subject_type='product'
      and f.as_of_date=(select max(as_of_date) from forecast_snapshots where organization_id=p_organization_id and target_metric='quantity' and subject_type='product')
    order by (f.predictions->>'recommended_reorder_qty')::numeric desc,(f.predictions->>'forecast_quantity')::numeric desc
    limit least(greatest(p_limit,1),100)
  ) x;

  return jsonb_build_object('matches',v_matches,'forecasts',v_forecasts,'generated_at',now(),
    'matching_note','자동 매칭은 추천이며 담당자 확인 후 confirmed 상태로 전환됩니다.',
    'forecast_note','예측은 저장된 집계 결과를 재사용하며 질문 시 재계산하지 않습니다.');
end $$;

commit;
