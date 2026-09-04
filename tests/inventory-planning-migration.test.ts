import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const migrationPath=fileURLToPath(new URL('../supabase/migrations/0013_inventory_planning_foundation.sql',import.meta.url));
const sql=readFileSync(migrationPath,'utf8');

const tables=[
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
];

test('inventory planning migration is transactional and defines every planning table',()=>{
  assert.match(sql,/^begin;/);
  assert.match(sql,/commit;\s*$/);
  for(const table of tables)assert.match(sql,new RegExp(`create table if not exists public\\.${table}\\s*\\(`));
});

test('every new planning table enables RLS and receives tenant policies',()=>{
  for(const table of tables){
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql,new RegExp(`'${table}'`));
  }
  assert.match(sql,/public\.is_org_member\(organization_id\)/);
  assert.match(sql,/public\.is_org_admin\(organization_id\)/);
});

test('recommendations remain traceable from scenario through execution and outcome',()=>{
  assert.match(sql,/recommendation_scenario_lines\(id\) on delete cascade/);
  assert.match(sql,/transfer_order_id uuid references public\.transfer_orders\(id\) on delete set null/);
  assert.match(sql,/add column if not exists recommendation_line_id uuid references public\.recommendation_scenario_lines\(id\)/);
  assert.match(sql,/uq_transfer_orders_recommendation_line/);
});

test('forecast quantiles and operational quantities have defensive constraints',()=>{
  assert.match(sql,/p10_qty <= p50_qty and p50_qty <= p90_qty/);
  assert.match(sql,/received_qty \+ cancelled_qty <= ordered_qty/);
  assert.match(sql,/max_stock_qty is null or max_stock_qty >= min_stock_qty/);
  assert.match(sql,/measurement_end_date >= measurement_start_date/);
});
