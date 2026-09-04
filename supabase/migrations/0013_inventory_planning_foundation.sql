begin;

-- Inventory planning foundation
--
-- Raw operational facts remain in inventory_snapshots, inventory_movements and
-- sales_orders. The tables below store planning inputs and reproducible outputs
-- so recommendations can be recalculated, reviewed and measured over time.

create table if not exists public.inventory_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  sku_id uuid references public.skus(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  policy_name text not null default 'default',
  priority integer not null default 100 check (priority >= 0),
  status text not null default 'active' check (status in ('draft','active','inactive')),
  effective_from date not null default current_date,
  effective_to date,
  review_period_days integer not null default 7 check (review_period_days between 1 and 366),
  lead_time_days integer not null default 14 check (lead_time_days between 0 and 366),
  safety_stock_days numeric(8,2) not null default 7 check (safety_stock_days >= 0),
  min_stock_qty numeric(16,3) not null default 0 check (min_stock_qty >= 0),
  max_stock_qty numeric(16,3) check (max_stock_qty is null or max_stock_qty >= 0),
  target_cover_days numeric(8,2) check (target_cover_days is null or target_cover_days >= 0),
  reorder_point_qty numeric(16,3) check (reorder_point_qty is null or reorder_point_qty >= 0),
  order_pack_qty numeric(16,3) not null default 1 check (order_pack_qty > 0),
  min_transfer_qty numeric(16,3) not null default 1 check (min_transfer_qty > 0),
  max_transfer_qty numeric(16,3) check (max_transfer_qty is null or max_transfer_qty > 0),
  location_capacity_qty numeric(16,3) check (location_capacity_qty is null or location_capacity_qty >= 0),
  transfer_budget_amount numeric(18,2) check (transfer_budget_amount is null or transfer_budget_amount >= 0),
  currency_code text not null default 'KRW',
  service_level_target numeric(7,4) not null default 0.9500 check (service_level_target > 0 and service_level_target <= 1),
  allow_rebalancing boolean not null default true,
  parameters jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (max_stock_qty is null or max_stock_qty >= min_stock_qty),
  unique nulls not distinct (organization_id,workspace_id,sku_id,location_id,policy_name,effective_from)
);

create table if not exists public.logistics_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  from_location_id uuid not null references public.locations(id) on delete cascade,
  to_location_id uuid not null references public.locations(id) on delete cascade,
  service_code text not null default 'standard',
  status text not null default 'active' check (status in ('active','inactive')),
  lead_time_days integer not null default 1 check (lead_time_days between 0 and 366),
  dispatch_weekdays smallint[] not null default array[1,2,3,4,5],
  cutoff_time time,
  min_shipment_qty numeric(16,3) not null default 1 check (min_shipment_qty > 0),
  max_shipment_qty numeric(16,3) check (max_shipment_qty is null or max_shipment_qty > 0),
  fixed_cost numeric(18,2) not null default 0 check (fixed_cost >= 0),
  variable_cost_per_unit numeric(18,4) not null default 0 check (variable_cost_per_unit >= 0),
  currency_code text not null default 'KRW',
  carbon_kg_per_unit numeric(18,6) check (carbon_kg_per_unit is null or carbon_kg_per_unit >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_location_id <> to_location_id),
  check (max_shipment_qty is null or max_shipment_qty >= min_shipment_qty),
  check (dispatch_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  unique nulls not distinct (organization_id,workspace_id,from_location_id,to_location_id,service_code)
);

create table if not exists public.inbound_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  source_id uuid references public.data_sources(id) on delete set null,
  source_order_id text,
  order_no text not null,
  supplier_code text,
  destination_location_id uuid not null references public.locations(id),
  status text not null default 'planned' check (status in ('planned','confirmed','in_transit','partially_received','received','cancelled')),
  ordered_at timestamptz,
  expected_at timestamptz,
  shipped_at timestamptz,
  received_at timestamptz,
  currency_code text not null default 'KRW',
  metadata jsonb not null default '{}'::jsonb,
  raw_upload_id uuid references public.raw_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,order_no)
);

create table if not exists public.inbound_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inbound_order_id uuid not null references public.inbound_orders(id) on delete cascade,
  source_line_id text,
  sku_id uuid not null references public.skus(id),
  ordered_qty numeric(16,3) not null check (ordered_qty > 0),
  shipped_qty numeric(16,3) not null default 0 check (shipped_qty >= 0),
  received_qty numeric(16,3) not null default 0 check (received_qty >= 0),
  cancelled_qty numeric(16,3) not null default 0 check (cancelled_qty >= 0),
  unit_cost numeric(18,2) check (unit_cost is null or unit_cost >= 0),
  expected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (shipped_qty <= ordered_qty),
  check (received_qty + cancelled_qty <= ordered_qty),
  unique (inbound_order_id,sku_id)
);

create table if not exists public.inventory_positions_daily (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  position_date date not null,
  sku_id uuid not null references public.skus(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  on_hand_qty numeric(16,3) not null default 0,
  reserved_qty numeric(16,3) not null default 0,
  available_qty numeric(16,3) not null default 0,
  inbound_confirmed_qty numeric(16,3) not null default 0,
  transfer_in_qty numeric(16,3) not null default 0,
  transfer_out_qty numeric(16,3) not null default 0,
  damaged_qty numeric(16,3) not null default 0,
  safety_stock_qty numeric(16,3) not null default 0,
  inventory_position_qty numeric(16,3) not null default 0,
  stockout_flag boolean not null default false,
  source_watermark timestamptz not null,
  calculation_version text not null,
  calculated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id,workspace_id,position_date,sku_id,location_id,calculation_version)
);

create table if not exists public.demand_forecasts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  as_of_date date not null,
  target_date date not null,
  sku_id uuid not null references public.skus(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  p10_qty numeric(16,3) not null check (p10_qty >= 0),
  p50_qty numeric(16,3) not null check (p50_qty >= 0),
  p90_qty numeric(16,3) not null check (p90_qty >= 0),
  lost_demand_uplift_qty numeric(16,3) not null default 0 check (lost_demand_uplift_qty >= 0),
  method text not null,
  model_version text not null,
  feature_version text,
  input_watermark timestamptz not null,
  diagnostics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  check (target_date >= as_of_date),
  check (p10_qty <= p50_qty and p50_qty <= p90_qty),
  unique nulls not distinct (organization_id,workspace_id,as_of_date,target_date,sku_id,location_id,model_version)
);

create table if not exists public.recommendation_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  refresh_run_id uuid references public.analytics_refresh_runs(id) on delete set null,
  scenario_key text not null,
  scenario_type text not null check (scenario_type in ('rebalancing','reorder','allocation')),
  as_of_date date not null,
  horizon_days integer not null check (horizon_days between 1 and 366),
  status text not null default 'draft' check (status in ('draft','ready','published','superseded','failed')),
  engine_version text not null,
  policy_snapshot jsonb not null default '{}'::jsonb,
  constraint_snapshot jsonb not null default '{}'::jsonb,
  objective_weights jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  source_watermark timestamptz not null,
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  unique nulls not distinct (organization_id,workspace_id,scenario_key,as_of_date,engine_version)
);

create table if not exists public.recommendation_scenario_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id uuid not null references public.recommendation_scenarios(id) on delete cascade,
  recommendation_key text not null,
  action_type text not null check (action_type in ('transfer','reorder','hold')),
  sku_id uuid not null references public.skus(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  recommended_qty numeric(16,3) not null check (recommended_qty >= 0),
  pack_rounded_qty numeric(16,3) not null check (pack_rounded_qty >= 0),
  forecast_demand_qty numeric(16,3) not null default 0 check (forecast_demand_qty >= 0),
  source_excess_qty numeric(16,3) not null default 0 check (source_excess_qty >= 0),
  destination_shortage_qty numeric(16,3) not null default 0 check (destination_shortage_qty >= 0),
  expected_revenue_gain numeric(18,2) not null default 0,
  expected_margin_gain numeric(18,2) not null default 0,
  expected_logistics_cost numeric(18,2) not null default 0 check (expected_logistics_cost >= 0),
  expected_net_value numeric(18,2) not null default 0,
  confidence numeric(7,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  rank integer check (rank is null or rank > 0),
  reason_codes text[] not null default '{}',
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (action_type='transfer' and from_location_id is not null and to_location_id is not null and from_location_id<>to_location_id)
    or (action_type='reorder' and from_location_id is null and to_location_id is not null)
    or (action_type='hold')
  ),
  unique (scenario_id,recommendation_key)
);

create table if not exists public.recommendation_decisions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_line_id uuid not null references public.recommendation_scenario_lines(id) on delete cascade,
  decision text not null check (decision in ('approved','adjusted','rejected','held','cancelled')),
  decided_qty numeric(16,3) check (decided_qty is null or decided_qty >= 0),
  reason_code text,
  note text,
  actor_user_id uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_line_id uuid not null references public.recommendation_scenario_lines(id) on delete cascade,
  transfer_order_id uuid references public.transfer_orders(id) on delete set null,
  measurement_start_date date not null,
  measurement_end_date date not null,
  baseline_method text not null,
  executed_qty numeric(16,3) not null default 0 check (executed_qty >= 0),
  realized_sales_qty numeric(16,3),
  avoided_stockout_qty numeric(16,3),
  realized_revenue_gain numeric(18,2),
  realized_margin_gain numeric(18,2),
  realized_logistics_cost numeric(18,2),
  realized_net_value numeric(18,2),
  forecast_error_pct numeric(9,4),
  quantity_error_pct numeric(9,4),
  outcome_status text not null default 'measuring' check (outcome_status in ('pending','measuring','complete','insufficient_data')),
  metrics jsonb not null default '{}'::jsonb,
  measured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (measurement_end_date >= measurement_start_date),
  unique (recommendation_line_id,measurement_start_date,measurement_end_date)
);

alter table public.transfer_orders
  add column if not exists recommendation_line_id uuid references public.recommendation_scenario_lines(id) on delete set null;

create index if not exists idx_inventory_policies_scope
  on public.inventory_policies(organization_id,workspace_id,status,effective_from desc,priority);
create index if not exists idx_logistics_routes_scope
  on public.logistics_routes(organization_id,workspace_id,status,from_location_id,to_location_id);
create index if not exists idx_inbound_orders_arrival
  on public.inbound_orders(organization_id,workspace_id,status,expected_at);
create unique index if not exists uq_inbound_orders_source_identity
  on public.inbound_orders(organization_id,source_id,source_order_id)
  where source_id is not null and source_order_id is not null;
create index if not exists idx_inbound_lines_sku
  on public.inbound_order_lines(organization_id,sku_id,inbound_order_id);
create unique index if not exists uq_inbound_lines_source_identity
  on public.inbound_order_lines(inbound_order_id,source_line_id)
  where source_line_id is not null;
create index if not exists idx_inventory_positions_lookup
  on public.inventory_positions_daily(organization_id,workspace_id,position_date desc,location_id,sku_id);
create index if not exists idx_demand_forecasts_lookup
  on public.demand_forecasts(organization_id,workspace_id,as_of_date desc,target_date,location_id,sku_id);
create index if not exists idx_recommendation_scenarios_latest
  on public.recommendation_scenarios(organization_id,workspace_id,scenario_type,status,as_of_date desc);
create index if not exists idx_recommendation_lines_value
  on public.recommendation_scenario_lines(organization_id,scenario_id,expected_net_value desc,rank);
create index if not exists idx_recommendation_decisions_line
  on public.recommendation_decisions(organization_id,recommendation_line_id,decided_at desc);
create index if not exists idx_recommendation_outcomes_period
  on public.recommendation_outcomes(organization_id,outcome_status,measurement_end_date desc);
create unique index if not exists uq_transfer_orders_recommendation_line
  on public.transfer_orders(recommendation_line_id)
  where recommendation_line_id is not null;

alter table public.inventory_policies enable row level security;
alter table public.logistics_routes enable row level security;
alter table public.inbound_orders enable row level security;
alter table public.inbound_order_lines enable row level security;
alter table public.inventory_positions_daily enable row level security;
alter table public.demand_forecasts enable row level security;
alter table public.recommendation_scenarios enable row level security;
alter table public.recommendation_scenario_lines enable row level security;
alter table public.recommendation_decisions enable row level security;
alter table public.recommendation_outcomes enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'inventory_policies',
    'logistics_routes',
    'inbound_orders',
    'inbound_order_lines',
    'inventory_positions_daily',
    'demand_forecasts',
    'recommendation_scenarios',
    'recommendation_scenario_lines',
    'recommendation_decisions',
    'recommendation_outcomes'
  ]
  loop
    execute format('drop policy if exists %I_member_select on public.%I',table_name,table_name);
    execute format('create policy %I_member_select on public.%I for select using (public.is_org_member(organization_id))',table_name,table_name);
    execute format('drop policy if exists %I_admin_write on public.%I',table_name,table_name);
    execute format('create policy %I_admin_write on public.%I for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id))',table_name,table_name);
  end loop;
end $$;

commit;
