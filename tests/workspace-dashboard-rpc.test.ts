import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/0021_workspace_dashboard_rpc.sql',import.meta.url),'utf8');

test('workspace dashboard RPC aggregates inside Postgres with tenant and workspace guards',()=>{
  assert.match(migration,/create or replace function public\.query_workspace_dashboard/i);
  assert.match(migration,/public\.is_workspace_member\(p_workspace_id\)/i);
  assert.match(migration,/w\.organization_id=p_organization_id/i);
  for(const table of ['sales_orders','sales_order_lines','inventory_snapshots']){
    assert.match(migration,new RegExp(`${table}[\\s\\S]{0,500}workspace_id=p_workspace_id`,'i'));
  }
  assert.match(migration,/page permission required/i);
  assert.match(migration,/p_limit:=least\(500,greatest\(1/i);
});

test('workspace dashboard RPC has indexes for the hot AX query paths',()=>{
  assert.match(migration,/idx_sales_orders_workspace_ordered/i);
  assert.match(migration,/idx_sales_order_lines_workspace_order/i);
  assert.match(migration,/idx_inventory_snapshots_workspace_latest/i);
});
