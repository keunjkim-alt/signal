import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dashboardCacheKey} from '../api/_lib/dashboard-cache.js';
import {workspaceFilter,workspaceId} from '../api/_lib/supabase.js';
import {operationalInsertValues,operationalUpdateFilters} from '../api/dashboards/query.js';

test('workspace helpers produce an explicit tenant filter',()=>{
  const context:any={membership:{organization_id:'org-1'},workspace:{id:'ws-1'}};
  assert.equal(workspaceId(context),'ws-1');
  assert.equal(workspaceFilter(context),'eq.ws-1');
  assert.equal(workspaceFilter({membership:{organization_id:'org-1'}}),'is.null');
});

test('dashboard cache cannot leak values between workspaces',()=>{
  const base:any={membership:{organization_id:'org-1',role:'owner'}};
  assert.notEqual(dashboardCacheKey({...base,workspace:{id:'ws-a'}},'overview'),dashboardCacheKey({...base,workspace:{id:'ws-b'}},'overview'));
});

test('dashboard approvals write and update only inside the active workspace',()=>{
  const context:any={membership:{organization_id:'org-1'},workspace:{id:'ws-1'}};
  assert.deepEqual(operationalInsertValues(context,{organization_id:'org-1',status:'approved'}),{organization_id:'org-1',status:'approved',workspace_id:'ws-1'});
  assert.deepEqual(operationalUpdateFilters(context,{organization_id:'eq.org-1',id:'eq.action-1'}),{organization_id:'eq.org-1',id:'eq.action-1',workspace_id:'eq.ws-1'});
});

test('workspace isolation migration covers operational and decision tables',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/0015_workspace_data_isolation.sql',import.meta.url),'utf8');
  for(const table of ['sales_orders','inventory_snapshots','forecast_snapshots','ax_recommendations','recommendation_outcomes'])assert.match(sql,new RegExp(`'${table}'`));
  assert.match(sql,/is_workspace_member/);
});

test('workspace natural keys allow the same SKU and location in separate workspaces',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/0016_workspace_unique_keys.sql',import.meta.url),'utf8');
  assert.match(sql,/products_org_workspace_product_code_key/);
  assert.match(sql,/inventory_snapshots_org_workspace_fact_key/);
  assert.match(sql,/unique nulls not distinct \(organization_id,workspace_id/);
});

test('two workspaces keep identical SKU facts and learned outcomes isolated',()=>{
  const facts=[
    {workspace_id:'ws-a',sku:'ARC-07',sales:12,forecast:10,outcome:2},
    {workspace_id:'ws-b',sku:'ARC-07',sales:3,forecast:8,outcome:-5}
  ];
  const view=(workspace:string)=>facts.filter(row=>row.workspace_id===workspace);
  assert.deepEqual(view('ws-a').map(row=>[row.sales,row.forecast,row.outcome]),[[12,10,2]]);
  assert.deepEqual(view('ws-b').map(row=>[row.sales,row.forecast,row.outcome]),[[3,8,-5]]);
});

test('planning, decisions, AX history and member access require workspace lineage',()=>{
  const planning=fs.readFileSync(new URL('../api/_lib/handlers/inventory-planning.ts',import.meta.url),'utf8');
  const decisions=fs.readFileSync(new URL('../api/_lib/handlers/decisions.ts',import.meta.url),'utf8');
  const history=fs.readFileSync(new URL('../api/ax/history.ts',import.meta.url),'utf8');
  const access=fs.readFileSync(new URL('../supabase/migrations/0018_workspace_membership_access.sql',import.meta.url),'utf8');
  assert.match(planning,/workspace=workspaceId\(context\)/);
  assert.match(planning,/workspace_id:`eq\.\$\{workspace\}`/);
  assert.match(decisions,/query\.set\('workspace_id'/);
  assert.match(history,/query\.set\('workspace_id'/);
  for(const table of ['workspace_memberships','recommendation_decisions','execution_events','ax_query_cache'])assert.match(access,new RegExp(table));
});
