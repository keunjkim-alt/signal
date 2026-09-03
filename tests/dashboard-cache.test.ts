import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedDashboardAggregate,dashboardCacheKey,dashboardCacheSize,invalidateDashboardCache} from '../api/_lib/dashboard-cache.ts';

const context=(organizationId='org-1',dataScope:any=null,permissions:any[]=[])=>({membership:{organization_id:organizationId,role:'manager',team_code:'sales',data_scope:dataScope},permissions});

test('dashboard cache deduplicates concurrent aggregate work and reuses the result',async()=>{
  invalidateDashboardCache();let calls=0;
  const loader=async()=>{calls++;await Promise.resolve();return {value:42}};
  const [first,second]=await Promise.all([cachedDashboardAggregate(context(),'inventory',1000,loader),cachedDashboardAggregate(context(),'inventory',1000,loader)]);
  const third=await cachedDashboardAggregate(context(),'inventory',1000,loader);
  assert.deepEqual(first,{value:42});assert.strictEqual(first,second);assert.strictEqual(second,third);assert.equal(calls,1);
});

test('dashboard cache isolates company and data-scope results',async()=>{
  invalidateDashboardCache();let calls=0;
  const loader=async()=>++calls;
  assert.notEqual(dashboardCacheKey(context('org-1',{countries:['KR']}),'customer'),dashboardCacheKey(context('org-1',{countries:['CN']}),'customer'));
  await cachedDashboardAggregate(context('org-1',{countries:['KR']}),'customer',1000,loader);
  await cachedDashboardAggregate(context('org-1',{countries:['CN']}),'customer',1000,loader);
  await cachedDashboardAggregate(context('org-2',{countries:['KR']}),'customer',1000,loader);
  assert.equal(calls,3);
});

test('dashboard cache isolates users with different page permissions',()=>{
  const viewer=context('org-1',null,[{page_key:'inventory',can_view:true,can_update:false,can_approve:false}]);
  const approver=context('org-1',null,[{page_key:'inventory',can_view:true,can_update:true,can_approve:true}]);
  assert.notEqual(dashboardCacheKey(viewer,'decision-actions'),dashboardCacheKey(approver,'decision-actions'));
});

test('organization invalidation removes only the affected workspace',async()=>{
  invalidateDashboardCache();let calls=0;const loader=async()=>++calls;
  await cachedDashboardAggregate(context('org-1'),'decision',1000,loader);
  await cachedDashboardAggregate(context('org-2'),'decision',1000,loader);
  assert.equal(dashboardCacheSize(),2);
  assert.equal(invalidateDashboardCache('org-1'),1);
  await cachedDashboardAggregate(context('org-1'),'decision',1000,loader);
  await cachedDashboardAggregate(context('org-2'),'decision',1000,loader);
  assert.equal(calls,3);
});

test('failed aggregate work is never cached',async()=>{
  invalidateDashboardCache();let calls=0;
  const loader=async()=>{calls++;if(calls===1)throw new Error('temporary');return 'recovered'};
  await assert.rejects(cachedDashboardAggregate(context(),'profitability',1000,loader),/temporary/);
  assert.equal(await cachedDashboardAggregate(context(),'profitability',1000,loader),'recovered');
  assert.equal(calls,2);
});
