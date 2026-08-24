begin;

create table if not exists public.discount_recommendation_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  channel_code text not null,
  as_of_date date not null,
  horizon_days integer not null check (horizon_days between 1 and 90),
  objective text not null default 'contribution_margin',
  model_version text not null default 'discount_optimizer_v1',
  current_discount_rate numeric(6,2) not null default 0,
  recommended_discount_rate numeric(6,2) not null default 0,
  recommendation_type text not null check (recommendation_type in ('hold_price','reduce_discount','maintain','targeted_discount')),
  expected_quantity numeric(18,2) not null default 0,
  expected_net_sales numeric(18,2) not null default 0,
  expected_contribution_margin numeric(18,2) not null default 0,
  contribution_uplift numeric(18,2) not null default 0,
  available_qty numeric(18,2) not null default 0,
  ending_inventory_qty numeric(18,2) not null default 0,
  inventory_cover_days numeric(10,2),
  confidence numeric(6,4) not null default 0,
  decision_status text not null default 'proposed' check (decision_status in ('proposed','approved','held','adjustment_requested')),
  non_discount_action text,
  rationale jsonb not null default '{}'::jsonb,
  scenario_results jsonb not null default '[]'::jsonb,
  input_watermark timestamptz,
  generated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  unique (organization_id,product_id,channel_code,as_of_date,horizon_days,model_version)
);

create index if not exists idx_discount_recommendations_latest
  on public.discount_recommendation_snapshots(organization_id,as_of_date desc,decision_status,recommended_discount_rate desc);

alter table public.discount_recommendation_snapshots enable row level security;
drop policy if exists discount_recommendations_member_select on public.discount_recommendation_snapshots;
create policy discount_recommendations_member_select on public.discount_recommendation_snapshots for select
using (public.is_org_member(organization_id));
drop policy if exists discount_recommendations_admin_write on public.discount_recommendation_snapshots;
create policy discount_recommendations_admin_write on public.discount_recommendation_snapshots for all
using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create or replace function public.refresh_discount_recommendations(
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
  values(p_organization_id,'discount_optimization',p_as_of_date,'running') returning id into v_run_id;

  select greatest(
    coalesce((select max(ordered_at) from sales_orders where organization_id=p_organization_id),'-infinity'::timestamptz),
    coalesce((select max(snapshot_at) from inventory_snapshots where organization_id=p_organization_id),'-infinity'::timestamptz)
  ) into v_watermark;

  with sales_base as (
    select l.product_id,o.channel_code,p.product_code,p.product_name,p.category_l1,
      sum(l.quantity)::numeric units_28d,
      count(distinct o.ordered_at::date)::numeric active_days,
      count(distinct round((1-l.unit_sale_price/nullif(l.unit_list_price,0))*100,0))::numeric observed_discount_points,
      sum(l.unit_list_price*l.quantity)/nullif(sum(l.quantity),0) list_price,
      sum(l.unit_cost*l.quantity)/nullif(sum(l.quantity),0) unit_cost,
      sum(l.channel_fee)/nullif(sum(l.net_sales),0) channel_fee_rate,
      sum(l.marketing_cost)/nullif(sum(l.net_sales),0) marketing_rate,
      sum(l.shipping_cost+l.return_cost)/nullif(sum(l.quantity),0) fulfilment_cost_per_unit,
      greatest(0,least(60,(1-sum(l.net_sales)/nullif(sum(l.unit_list_price*l.quantity),0))*100)) current_discount_rate,
      sum(l.returned_quantity)/nullif(sum(l.quantity),0) return_rate
    from sales_orders o
    join sales_order_lines l on l.order_id=o.id
    join products p on p.id=l.product_id
    where o.organization_id=p_organization_id
      and o.ordered_at>=p_as_of_date-27 and o.ordered_at<p_as_of_date+1
      and l.product_id is not null
    group by l.product_id,o.channel_code,p.product_code,p.product_name,p.category_l1
  ), latest_inventory as (
    select product_id,sum(available_qty)::numeric available_qty
    from (
      select distinct on (s.product_id,i.sku_id,i.location_id)
        s.product_id,i.sku_id,i.location_id,i.available_qty
      from inventory_snapshots i join skus s on s.id=i.sku_id
      where i.organization_id=p_organization_id and i.snapshot_at<p_as_of_date+1
      order by s.product_id,i.sku_id,i.location_id,i.snapshot_at desc
    ) latest
    group by product_id
  ), features as (
    select b.*,coalesce(i.available_qty,0) available_qty,
      greatest(.1,b.units_28d/28.0) base_daily_quantity,
      case b.category_l1 when 'OUTER' then 1.10 when 'DRESS' then 1.25 when 'BOTTOM' then 1.35 else 1.45 end elasticity,
      coalesce(i.available_qty,0)/nullif(greatest(.1,b.units_28d/28.0),0) inventory_cover_days,
      least(.90,greatest(.48,.42+(b.active_days/28.0)*.28+least(3,b.observed_discount_points)*.06)) confidence
    from sales_base b left join latest_inventory i on i.product_id=b.product_id
  ), candidates as (
    select f.*,d.candidate_discount_rate,
      least(f.available_qty,
        f.base_daily_quantity*p_horizon_days*
        power(greatest(.25,(1-d.candidate_discount_rate/100.0)/greatest(.25,1-f.current_discount_rate/100.0)),-f.elasticity)
      ) expected_quantity
    from features f cross join unnest(array[0,5,10,15,20,30]::numeric[]) d(candidate_discount_rate)
  ), economics as (
    select c.*,
      c.expected_quantity*c.list_price*(1-c.candidate_discount_rate/100.0) expected_net_sales,
      c.expected_quantity*(c.list_price*(1-c.candidate_discount_rate/100.0)*(1-c.channel_fee_rate-c.marketing_rate)-c.unit_cost-c.fulfilment_cost_per_unit) expected_contribution_margin,
      greatest(0,c.available_qty-c.expected_quantity) ending_inventory_qty,
      greatest(0,c.available_qty-c.expected_quantity)*c.unit_cost*
        (.05+least(.40,greatest(0,(coalesce(c.inventory_cover_days,0)-p_horizon_days)/100.0))) inventory_risk_cost
    from candidates c
  ), scored as (
    select e.*,
      e.expected_contribution_margin-e.inventory_risk_cost optimization_score,
      row_number() over(partition by e.product_id,e.channel_code order by e.expected_contribution_margin-e.inventory_risk_cost desc,e.candidate_discount_rate asc) scenario_rank,
      max(e.expected_contribution_margin) filter(where abs(e.candidate_discount_rate-e.current_discount_rate)<=3)
        over(partition by e.product_id,e.channel_code) baseline_contribution
    from economics e
  ), scenario_pack as (
    select product_id,channel_code,
      jsonb_agg(jsonb_build_object(
        'discount_rate',candidate_discount_rate,
        'expected_quantity',round(expected_quantity,0),
        'expected_net_sales',round(expected_net_sales,0),
        'expected_contribution_margin',round(expected_contribution_margin,0),
        'ending_inventory_qty',round(ending_inventory_qty,0),
        'optimization_score',round(optimization_score,0)
      ) order by candidate_discount_rate) scenario_results
    from scored group by product_id,channel_code
  ), winners as (
    select s.*,p.scenario_results
    from scored s join scenario_pack p using(product_id,channel_code)
    where s.scenario_rank=1
  )
  insert into discount_recommendation_snapshots(
    organization_id,product_id,channel_code,as_of_date,horizon_days,objective,model_version,
    current_discount_rate,recommended_discount_rate,recommendation_type,expected_quantity,expected_net_sales,
    expected_contribution_margin,contribution_uplift,available_qty,ending_inventory_qty,inventory_cover_days,
    confidence,non_discount_action,rationale,scenario_results,input_watermark,generated_at
  )
  select p_organization_id,product_id,channel_code,p_as_of_date,p_horizon_days,'contribution_margin','discount_optimizer_v1',
    round(current_discount_rate,1),candidate_discount_rate,
    case when candidate_discount_rate<=5 and current_discount_rate>7 then 'reduce_discount'
         when candidate_discount_rate<=5 then 'hold_price'
         when candidate_discount_rate>current_discount_rate+2 then 'targeted_discount'
         else 'maintain' end,
    round(expected_quantity,0),round(expected_net_sales,0),round(expected_contribution_margin,0),
    round(expected_contribution_margin-coalesce(baseline_contribution,expected_contribution_margin),0),
    round(available_qty,0),round(ending_inventory_qty,0),round(inventory_cover_days,1),round(confidence,4),
    case when inventory_cover_days<21 then '할인보다 부족 매장으로 재고 이동 우선'
         when inventory_cover_days<42 then '상품 노출과 CRM 타겟 확대로 정상가 소진 우선'
         else '재고가 많은 채널·매장에만 할인 범위 제한' end,
    jsonb_build_object(
      'product_code',product_code,'product_name',product_name,'category',category_l1,
      'elasticity',elasticity,'base_daily_quantity',round(base_daily_quantity,2),'return_rate',round(return_rate*100,1),
      'minimum_margin_guardrail','상품 원가·채널비·물류비 차감 후 기여이익 양수',
      'method_note','0·5·10·15·20·30% 후보 중 기여이익에서 잔여재고 위험비용을 차감한 값이 가장 큰 안'
    ),scenario_results,v_watermark,now()
  from winners
  on conflict (organization_id,product_id,channel_code,as_of_date,horizon_days,model_version) do update set
    current_discount_rate=excluded.current_discount_rate,recommended_discount_rate=excluded.recommended_discount_rate,
    recommendation_type=excluded.recommendation_type,expected_quantity=excluded.expected_quantity,
    expected_net_sales=excluded.expected_net_sales,expected_contribution_margin=excluded.expected_contribution_margin,
    contribution_uplift=excluded.contribution_uplift,available_qty=excluded.available_qty,
    ending_inventory_qty=excluded.ending_inventory_qty,inventory_cover_days=excluded.inventory_cover_days,
    confidence=excluded.confidence,non_discount_action=excluded.non_discount_action,rationale=excluded.rationale,
    scenario_results=excluded.scenario_results,input_watermark=excluded.input_watermark,generated_at=now();
  get diagnostics v_rows=row_count;

  update analytics_refresh_runs set status='completed',output_rows=v_rows,source_watermark=v_watermark,completed_at=now()
  where id=v_run_id;
  return jsonb_build_object('run_id',v_run_id,'recommendation_rows',v_rows,'source_watermark',v_watermark);
exception when others then
  update analytics_refresh_runs set status='failed',error_message=sqlerrm,completed_at=now() where id=v_run_id;
  raise;
end $$;

create or replace function public.query_discount_recommendations(
  p_organization_id uuid,
  p_page_key text default 'profitability',
  p_limit integer default 40
) returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  v_role text;
  v_rows jsonb;
begin
  select role into v_role from organization_memberships
  where organization_id=p_organization_id and user_id=auth.uid() and status='active';
  if v_role is null then raise exception 'not authorized'; end if;
  if v_role not in ('owner','admin') and not exists(
    select 1 from page_permissions pp join organization_memberships m on m.id=pp.membership_id
    where m.organization_id=p_organization_id and m.user_id=auth.uid() and pp.page_key=p_page_key and pp.can_view
  ) then raise exception 'page permission required'; end if;

  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into v_rows from (
    select d.id recommendation_id,p.product_code,p.product_name,p.image_url,d.channel_code,d.as_of_date,d.horizon_days,
      d.current_discount_rate,d.recommended_discount_rate,d.recommendation_type,d.expected_quantity,
      d.expected_net_sales,d.expected_contribution_margin,d.contribution_uplift,d.available_qty,d.ending_inventory_qty,
      d.inventory_cover_days,d.confidence,d.decision_status,d.non_discount_action,d.rationale,d.scenario_results,
      d.input_watermark,d.generated_at
    from discount_recommendation_snapshots d join products p on p.id=d.product_id
    where d.organization_id=p_organization_id
      and d.as_of_date=(select max(as_of_date) from discount_recommendation_snapshots where organization_id=p_organization_id)
    order by case d.decision_status when 'proposed' then 0 else 1 end,
      greatest(d.contribution_uplift,0) desc,d.inventory_cover_days desc
    limit least(greatest(p_limit,1),100)
  ) x;

  return jsonb_build_object(
    'recommendations',v_rows,'generated_at',now(),
    'note','추천값은 저장된 시나리오 계산 결과이며 AX 질문 시 원천 주문을 다시 분석하지 않습니다.',
    'objective','기여이익 최대화 − 잔여재고 위험비용',
    'guardrail','브랜드 최대 할인율·최소 이익률·채널 가격정책을 승인 단계에서 적용합니다.'
  );
end $$;

commit;
