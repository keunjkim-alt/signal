do $$
declare
  org uuid; brand uuid; source uuid; product_id uuid; sku_id uuid; location_id uuid; order_id uuid;
  product_codes text[]:=array['ARC-07','FLOW-22','EASE-19','CORE-08','AIR-24','FRAME-31','SHEER-15','FORM-12'];
  product_names text[]:=array['Utility Jacket','Drape Pants','Layer Top','Core Knit','Volume Dress','Denim Dress','Sheer Layer Top','Relaxed Blazer'];
  product_images text[]:=array['9106213558.jpg','9106231204.jpg','9175222986.jpg','9176222988.jpg','9106241204.jpg','9106141101.jpg','9176222989.jpg','9176212982.jpg'];
  location_codes text[]:=array['STORE-SEONGSU','STORE-GANGNAM','STORE-HANNAM','STORE-BUSAN','STORE-SHANGHAI','STORE-TOKYO','DC-ONLINE'];
  location_names text[]:=array['성수 플래그십','강남점','한남점','부산 센텀','상하이 IFC','도쿄 시부야','온라인 DC'];
  location_countries text[]:=array['KR','KR','KR','KR','CN','JP','KR'];
  channels text[]:=array['자사몰','무신사','네이버','29CM','W컨셉','매장 POS'];
  i integer; d integer; n integer; qty integer; price numeric; cost numeric;
begin
  select id into org from public.organizations where slug='viceversa-fashion-ax';
  if org is null then raise exception 'organization not found'; end if;
  select id into brand from public.brands where organization_id=org and code='DEMO';
  select id into source from public.data_sources where organization_id=org and provider='fashion-ax-demo' limit 1;
  if source is null then
    insert into public.data_sources(organization_id,brand_id,source_type,provider,name,status,sync_mode,last_synced_at)
    values(org,brand,'api','fashion-ax-demo','VIIMsginal Demo Generator','active','scheduled',now())
    returning id into source;
  else
    update public.data_sources
    set brand_id=brand,status='active',sync_mode='scheduled',last_synced_at=now(),updated_at=now()
    where id=source;
  end if;

  for i in 1..array_length(product_codes,1) loop
    insert into public.products(organization_id,brand_id,product_code,product_name,category_l1,season,image_url,attributes)
    values(org,brand,product_codes[i],product_names[i],case when i in (1,6,8) then 'OUTER' when i in (2) then 'BOTTOM' when i in (5) then 'DRESS' else 'TOP' end,'26SS','/assets/products/'||product_images[i],jsonb_build_object('designer',case when i%3=0 then '이하나' when i%2=0 then '박민준' else '김서윤' end,'demo',true))
    on conflict(organization_id,product_code) do update set product_name=excluded.product_name,image_url=excluded.image_url,attributes=excluded.attributes
    returning id into product_id;
    if product_id is null then select id into product_id from public.products where organization_id=org and product_code=product_codes[i]; end if;
    insert into public.skus(organization_id,product_id,sku_code,color,size,external_codes)
    values(org,product_id,product_codes[i]||'-BLK-F','BLACK','F',jsonb_build_object('demo',true))
    on conflict(organization_id,sku_code) do update set product_id=excluded.product_id returning id into sku_id;
  end loop;

  for i in 1..array_length(location_codes,1) loop
    insert into public.locations(organization_id,brand_id,location_code,location_name,location_type,country_code,region)
    values(org,brand,location_codes[i],location_names[i],case when i=7 then 'online_dc' else 'store' end,location_countries[i],case when i<=3 then '서울' when i=4 then '부산' when i=5 then '상하이' when i=6 then '도쿄' else '온라인' end)
    on conflict(organization_id,location_code) do update set location_name=excluded.location_name,country_code=excluded.country_code;
  end loop;

  delete from public.sales_order_lines sol
  where sol.organization_id=org
    and sol.order_id in(select so.id from public.sales_orders so where so.organization_id=org and so.source_id=source);
  delete from public.sales_orders where organization_id=org and source_id=source;
  delete from public.inventory_snapshots where organization_id=org and source_id=source;

  for d in 0..44 loop
    for i in 1..array_length(product_codes,1) loop
      select p.id,s.id into product_id,sku_id from public.products p join public.skus s on s.product_id=p.id where p.organization_id=org and p.product_code=product_codes[i] limit 1;
      for n in 1..6 loop
        qty:=greatest(1,round((9+i*2+n*3)*(1+sin((d+i+n)::numeric)/3))::integer);
        price:=case when i in (1,6,8) then 248000 when i=2 then 158000 when i=5 then 198000 else 89000 end;
        cost:=round(price*(0.27+i*0.012),0);
        select id into location_id from public.locations where organization_id=org and location_code=location_codes[case when n=6 then 1 else n end];
        insert into public.sales_orders(id,organization_id,source_id,source_order_id,channel_code,location_id,ordered_at,status,country_code,gross_amount,discount_amount,paid_amount,customer_token,shipping_region_1,shipping_region_2)
        values(gen_random_uuid(),org,source,'DEMO-'||to_char(current_date-d,'YYYYMMDD')||'-'||i||'-'||n,channels[n],case when channels[n]='매장 POS' then location_id else null end,(current_date-d)+make_interval(hours=>10+((i+n+d)%13),mins=>((i*n*7)%60)),'paid',case when n=6 and i=5 then 'CN' when n=6 and i=6 then 'JP' else 'KR' end,qty*price,qty*price*(case when n in(2,4,5) then .12 else .05 end),qty*price*(case when n in(2,4,5) then .88 else .95 end),'CUST-'||lpad(((d*17+i*11+n)%260+1)::text,4,'0'),case when n=6 then case when i=5 then '상하이' when i=6 then '도쿄' else '서울' end else (array['서울','경기','부산','대구','인천'])[((d+i+n)%5)+1] end,case when (d+i)%3=0 then '강남구' else '성동구' end)
        returning id into order_id;
        insert into public.sales_order_lines(organization_id,order_id,sku_id,product_id,quantity,returned_quantity,unit_list_price,unit_sale_price,net_sales,unit_cost,channel_fee,marketing_cost,shipping_cost,return_cost)
        values(org,order_id,sku_id,product_id,qty,case when (d+i+n)%13=0 then greatest(1,round(qty*.12)) else 0 end,price,round(price*(case when n in(2,4,5) then .88 else .95 end),0),round(qty*price*(case when n in(2,4,5) then .88 else .95 end),0),cost,round(qty*price*(case when n=1 then .035 when n=6 then .02 else .13 end),0),round(qty*price*(case when n in(1,2,4) then .045 else .025 end),0),case when n=6 then 0 else 3500 end,case when (d+i+n)%13=0 then round(qty*price*.025,0) else 0 end);
      end loop;
    end loop;
  end loop;

  for i in 1..array_length(product_codes,1) loop
    select s.id into sku_id from public.skus s join public.products p on p.id=s.product_id where p.organization_id=org and p.product_code=product_codes[i] limit 1;
    for n in 1..array_length(location_codes,1) loop
      select id into location_id from public.locations where organization_id=org and location_code=location_codes[n];
      insert into public.inventory_snapshots(organization_id,source_id,sku_id,location_id,snapshot_at,on_hand_qty,reserved_qty,available_qty,in_transit_qty,safety_stock_qty)
      values(org,source,sku_id,location_id,date_trunc('hour',now()),140+i*38+n*24,(i+n)%17,125+i*34+n*21,case when (i+n)%4=0 then 40 else 0 end,35+i*3)
      on conflict do nothing;
    end loop;
  end loop;
end $$;
