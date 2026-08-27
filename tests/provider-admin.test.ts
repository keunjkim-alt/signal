import test from 'node:test';
import assert from 'node:assert/strict';
import {applyProviderFilters,classifySourceHealth,computePortfolioSummary,filterProviderScope,providerCan} from '../api/_lib/provider-admin.ts';

test('provider roles expose only their intended operational permissions',()=>{
  assert.equal(providerCan('super_admin','assignment.manage'),true);
  assert.equal(providerCan('auditor','audit.view'),true);
  assert.equal(providerCan('auditor','attention.manage'),false);
  assert.equal(providerCan('account_manager','source.view'),true);
});

test('assigned organizations and workspaces isolate provider rows',()=>{
  const context={provider:{role:'data_ops'},assignments:[{organization_id:'org-a',workspace_id:null},{organization_id:null,workspace_id:'ws-c'}]};
  const rows=[{organization_id:'org-a',workspace_id:'ws-a'},{organization_id:'org-b',workspace_id:'ws-b'},{organization_id:'org-c',workspace_id:'ws-c'}];
  assert.deepEqual(filterProviderScope(context,rows),[rows[0],rows[2]]);
  assert.equal(filterProviderScope({provider:{role:'super_admin'},assignments:[]},rows).length,3);
});

test('source health reflects failures, pauses, and sync freshness',()=>{
  const now=new Date('2026-08-27T12:00:00Z');
  assert.equal(classifySourceHealth({status:'error'},now),'error');
  assert.equal(classifySourceHealth({status:'paused'},now),'paused');
  assert.equal(classifySourceHealth({status:'active',sync_mode:'realtime',last_synced_at:'2026-08-27T11:00:00Z'},now),'healthy');
  assert.equal(classifySourceHealth({status:'active',sync_mode:'scheduled',last_synced_at:'2026-08-25T00:00:00Z'},now),'stale');
});

test('portfolio summary counts cross-brand operational risk',()=>{
  const workspaces=[{organization_id:'a',status:'active'},{organization_id:'a',status:'paused'},{organization_id:'b',status:'active'}],attention=[{status:'open',severity:'critical',sla_due_at:'2020-01-01'},{status:'resolved',severity:'critical'}],sources=[{status:'active',sync_mode:'scheduled',last_synced_at:new Date().toISOString()},{status:'error'}];
  assert.deepEqual(computePortfolioSummary(workspaces,attention,sources),{organizations:2,workspaces:3,activeWorkspaces:2,openAttention:1,criticalAttention:1,overdueAttention:1,sources:2,healthySources:1,unhealthySources:1});
});

test('provider filters combine workspace, status, and search',()=>{
  const rows=[{organization_id:'a',workspace_id:'w1',status:'active',name:'서울 브랜드'},{organization_id:'a',workspace_id:'w2',status:'paused',name:'부산 브랜드'}];
  assert.deepEqual(applyProviderFilters(rows,{organizationId:'a',workspaceId:'w1',status:'active',search:'서울'}),[rows[0]]);
});
