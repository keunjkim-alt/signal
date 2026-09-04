import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedWorkspaceAccess,invalidateWorkspaceAccessCache,workspaceAccessCacheKey,workspaceAccessCacheSize} from '../api/_lib/workspace-access-cache.ts';

const membership={id:'member-1',organization_id:'org-1',role:'member',data_scope:{brands:['brand-b','brand-a']}};

test('workspace access cache deduplicates concurrent reads and normalizes brand scope',async()=>{
  invalidateWorkspaceAccessCache();let calls=0;
  const loader=async()=>{calls++;await Promise.resolve();return [{id:'workspace-1'}]};
  const [first,second]=await Promise.all([cachedWorkspaceAccess(membership,loader),cachedWorkspaceAccess(membership,loader)]);
  const reordered={...membership,data_scope:{brands:['brand-a','brand-b']}};
  const third=await cachedWorkspaceAccess(reordered,loader);
  assert.strictEqual(first,second);
  assert.strictEqual(second,third);
  assert.equal(calls,1);
  assert.equal(workspaceAccessCacheSize(),1);
  assert.equal(workspaceAccessCacheKey(membership),workspaceAccessCacheKey(reordered));
});

test('workspace access cache isolates members and can invalidate an organization',async()=>{
  invalidateWorkspaceAccessCache();let calls=0;
  const loader=async()=>[{id:`workspace-${++calls}`}];
  await cachedWorkspaceAccess(membership,loader);
  await cachedWorkspaceAccess({...membership,id:'member-2'},loader);
  await cachedWorkspaceAccess({...membership,organization_id:'org-2'},loader);
  assert.equal(calls,3);
  assert.equal(invalidateWorkspaceAccessCache('org-1'),2);
  assert.equal(workspaceAccessCacheSize(),1);
});

test('failed workspace access reads are not cached',async()=>{
  invalidateWorkspaceAccessCache();let calls=0;
  const loader=async()=>{calls++;if(calls===1)throw new Error('temporary outage');return [{id:'workspace-1'}]};
  await assert.rejects(cachedWorkspaceAccess(membership,loader),/temporary outage/);
  assert.equal((await cachedWorkspaceAccess(membership,loader))[0].id,'workspace-1');
  assert.equal(calls,2);
});
