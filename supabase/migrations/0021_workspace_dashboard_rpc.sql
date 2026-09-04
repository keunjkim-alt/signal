begin;

-- Aggregate workspace facts inside Postgres so AX questions do not download and
-- join tens of thousands of raw rows in the serverless function.
create index if not exists idx_sales_orders_workspace_ordered
  on public.sales_orders(organization_id,workspace_id,ordered_at desc);
create index if not exists idx_sales_order_lines_workspace_order
  on public.sales_order_lines(organization_id,workspace_id,order_id);
create index if not exists idx_inventory_snapshots_workspace_latest
  on public.inventory_snapshots(organization_id,workspace_id,sku_id,location_id,snapshot_at desc);

create or replace function public.query_workspace_dashboard(
  p_organization_id uuid,
  p_workspace_id uuid,
  p_page_key text default 'hub',
  p_metric text default 'net_sales',
  p_dimension text default 'channel',
  p_start timestamptz default now() - interval '7 days',
  p_end timestamptz default now(),
  p_countries text[] default null,
  p_channels text[] default null,
  p_locations text[] default null,
  p_product text default null,
  p_limit integer default 100
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
  if not exists(
    select 1 from public.workspaces w
    where w.id=p_workspace_id and w.organization_id=p_organization_id
  ) or not public.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access required';
  end if;

  select m.role,m.data_scope into member_role,member_scope
  from public.organization_memberships m
  where m.organization_id=p_organization_id and m.user_id=auth.uid() and m.status='active';
  if member_role is null then raise exception 'not authorized'; end if;
  if member_role not in ('owner','admin') and not exists(
    select 1 from public.page_permissions pp
    join public.organization_memberships m on m.id=pp.membership_id
    where m.organization_id=p_organization_id and m.user_id=auth.uid()
      and pp.page_key=p_page_key and pp.can_view
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
  p_limit:=least(500,greatest(1,coalesce(p_limit,100)));

  if p_metric in ('available_qty','inventory_cover_days','sell_through_rate') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      with latest as (
        select distinct on (i.sku_id,i.location_id)
          i.sku_id,i.location_id,i.available_qty
        from public.inventory_snapshots i
        where i.organization_id=p_organization_id and i.workspace_id=p_workspace_id
          and i.snapshot_at<p_end
        order by i.sku_id,i.location_id,i.snapshot_at desc
      ), velocity as (
        select l.sku_id,o.location_id,sum(l.quantity) as sold,
          sum(l.quantity)/greatest(extract(epoch from (p_end-p_start))/86400,1) as daily_sales
        from public.sales_orders o
        join public.sales_order_lines l on l.order_id=o.id
          and l.organization_id=p_organization_id and l.workspace_id=p_workspace_id
        where o.organization_id=p_organization_id and o.workspace_id=p_workspace_id
          and o.ordered_at>=p_start and o.ordered_at<p_end
          and (p_countries is null or o.country_code=any(p_countries))
          and (p_channels is null or o.channel_code=any(p_channels))
        group by l.sku_id,o.location_id
      ), grouped as (
        select
          case when p_dimension='location' then coalesce(loc.location_name,loc.location_code,'미지정')
               else coalesce(prod.product_name,prod.product_code,sku.sku_code,'미지정') end as label,
          case when p_dimension='product' then max(prod.image_url) else null end as image_url,
          sum(latest.available_qty) as available_qty,
          round((sum(latest.available_qty)/nullif(sum(coalesce(velocity.daily_sales,0)),0))::numeric,1) as inventory_cover_days,
          round((sum(coalesce(velocity.sold,0))/nullif(sum(coalesce(velocity.sold,0))+sum(latest.available_qty),0)*100)::numeric,1) as sell_through_rate
        from latest
        join public.skus sku on sku.id=latest.sku_id and sku.workspace_id=p_workspace_id
        left join public.products prod on prod.id=sku.product_id and prod.workspace_id=p_workspace_id
        join public.locations loc on loc.id=latest.location_id and loc.workspace_id=p_workspace_id
        left join velocity on velocity.sku_id=latest.sku_id and velocity.location_id=latest.location_id
        where (p_locations is null or loc.location_code=any(p_locations))
          and (p_countries is null or loc.country_code=any(p_countries))
          and (p_product is null or prod.product_name ilike '%'||p_product||'%'
            or prod.product_code ilike '%'||p_product||'%' or sku.sku_code ilike '%'||p_product||'%')
        group by case when p_dimension='location' then coalesce(loc.location_name,loc.location_code,'미지정')
                      else coalesce(prod.product_name,prod.product_code,sku.sku_code,'미지정') end
      )
      select label,label as dimension,image_url,available_qty,inventory_cover_days,sell_through_rate,
        case when p_metric='inventory_cover_days' then inventory_cover_days
             when p_metric='sell_through_rate' then sell_through_rate else available_qty end as value
      from grouped
      order by value desc nulls last
      limit p_limit
    ) x;
  else
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
      with grouped as (
        select
          case when p_dimension='channel' then coalesce(o.channel_code,'미지정')
               when p_dimension='location' then coalesce(loc.location_name,loc.location_code,'온라인')
               when p_dimension='product' then coalesce(prod.product_name,prod.product_code,sku.sku_code,'미지정')
               else to_char(date_trunc('day',o.ordered_at),'YYYY-MM-DD') end as label,
          case when p_dimension='product' then max(prod.image_url) else null end as image_url,
          sum(l.net_sales) as net_sales,
          sum(l.quantity) as quantity,
          count(distinct o.id) as orders,
          sum(l.net_sales-l.unit_cost*l.quantity-l.channel_fee-l.marketing_cost-l.shipping_cost-l.return_cost) as contribution_margin,
          round((sum(l.returned_quantity)/nullif(sum(l.quantity),0)*100)::numeric,1) as return_rate
        from public.sales_orders o
        join public.sales_order_lines l on l.order_id=o.id
          and l.organization_id=p_organization_id and l.workspace_id=p_workspace_id
        left join public.locations loc on loc.id=o.location_id and loc.workspace_id=p_workspace_id
        left join public.skus sku on sku.id=l.sku_id and sku.workspace_id=p_workspace_id
        left join public.products prod on prod.id=coalesce(l.product_id,sku.product_id) and prod.workspace_id=p_workspace_id
        where o.organization_id=p_organization_id and o.workspace_id=p_workspace_id
          and o.ordered_at>=p_start and o.ordered_at<p_end
          and (p_countries is null or o.country_code=any(p_countries))
          and (p_channels is null or o.channel_code=any(p_channels))
          and (p_locations is null or loc.location_code=any(p_locations))
          and (p_product is null or prod.product_name ilike '%'||p_product||'%'
            or prod.product_code ilike '%'||p_product||'%' or sku.sku_code ilike '%'||p_product||'%')
        group by case when p_dimension='channel' then coalesce(o.channel_code,'미지정')
                      when p_dimension='location' then coalesce(loc.location_name,loc.location_code,'온라인')
                      when p_dimension='product' then coalesce(prod.product_name,prod.product_code,sku.sku_code,'미지정')
                      else to_char(date_trunc('day',o.ordered_at),'YYYY-MM-DD') end
      )
      select label,label as dimension,image_url,net_sales,quantity,orders,contribution_margin,return_rate,
        case when p_metric='quantity' then quantity
             when p_metric='orders' then orders
             when p_metric='contribution_margin' then contribution_margin
             when p_metric='return_rate' then return_rate else net_sales end as value
      from grouped
      order by case when p_dimension='day' then label end asc,
               case when p_dimension<>'day' then
                 case when p_metric='quantity' then quantity
                      when p_metric='orders' then orders
                      when p_metric='contribution_margin' then contribution_margin
                      when p_metric='return_rate' then return_rate else net_sales end
               end desc nulls last
      limit p_limit
    ) x;
  end if;

  return jsonb_build_object(
    'dimension',p_dimension,
    'rows',result,
    'generated_at',now(),
    'workspace_id',p_workspace_id,
    'source','workspace_dashboard_rpc'
  );
end $$;

grant execute on function public.query_workspace_dashboard(
  uuid,uuid,text,text,text,timestamptz,timestamptz,text[],text[],text[],text,integer
) to authenticated;

commit;
