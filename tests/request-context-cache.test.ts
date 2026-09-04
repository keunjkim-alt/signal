import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedRequestContext,cachedRequestIdentity,invalidateRequestContextCache,requestContextCacheKey,requestContextCacheSize,requestIdentityCacheSize} from '../api/_lib/request-context-cache.ts';

const context=(token:string,organizationId:string,userId='user-1')=>({accessToken:token,user:{id:userId},membership:{organization_id:organizationId}});

test('request context cache deduplicates concurrent authentication work',async()=>{
  invalidateRequestContextCache();let calls=0;
  const loader=async()=>{calls++;await Promise.resolve();return context('secret-token','org-1')};
  const [first,second]=await Promise.all([
    cachedRequestContext('secret-token','org-1',{},loader),
    cachedRequestContext('secret-token','org-1',{},loader)
  ]);
  const third=await cachedRequestContext('secret-token','org-1',{},loader);
  assert.strictEqual(first,second);assert.strictEqual(second,third);assert.equal(calls,1);
});

test('request context cache never exposes a raw token in its key',()=>{
  const key=requestContextCacheKey('a-high-entropy-access-token','org-1',{});
  assert.equal(key.includes('a-high-entropy-access-token'),false);
  assert.match(key,/^[a-f0-9]{24}\|org:org-1\|/);
});

test('request context cache isolates token, company, and permission options',async()=>{
  invalidateRequestContextCache();let calls=0;const loader=async()=>context(`token-${++calls}`,'org-1');
  await cachedRequestContext('token-a','org-1',{},loader);
  await cachedRequestContext('token-b','org-1',{},loader);
  await cachedRequestContext('token-a','org-2',{},loader);
  await cachedRequestContext('token-a','org-1',{includeBrands:false},loader);
  await cachedRequestContext('token-a','org-1',{permissionPage:'connections'},loader);
  assert.equal(calls,5);
});

test('request context invalidation can target a signed-in token',async()=>{
  invalidateRequestContextCache();let calls=0;const loader=async()=>context('token-a','org-1');
  await cachedRequestContext('token-a','org-1',{},async()=>{calls++;return loader()});
  await cachedRequestContext('token-b','org-1',{},async()=>{calls++;return context('token-b','org-1')});
  assert.equal(requestContextCacheSize(),2);
  assert.equal(invalidateRequestContextCache({accessToken:'token-a'}),1);
  await cachedRequestContext('token-a','org-1',{},async()=>{calls++;return loader()});
  await cachedRequestContext('token-b','org-1',{},async()=>{calls++;return context('token-b','org-1')});
  assert.equal(calls,3);
});

test('failed authentication work is never cached',async()=>{
  invalidateRequestContextCache();let calls=0;
  const loader=async()=>{calls++;if(calls===1)throw new Error('temporary auth outage');return context('token-a','org-1')};
  await assert.rejects(cachedRequestContext('token-a','org-1',{},loader),/temporary auth outage/);
  assert.equal((await cachedRequestContext('token-a','org-1',{},loader)).membership.organization_id,'org-1');
  assert.equal(calls,2);
});

test('identity lookup is reused across page-specific context options',async()=>{
  invalidateRequestContextCache();let calls=0;
  const loadIdentity=async()=>{calls++;return {user:{id:'user-1'},membership:{id:'member-1',organization_id:'org-1'}}};
  const first=await cachedRequestIdentity('token-a','org-1',loadIdentity);
  const second=await cachedRequestIdentity('token-a','org-1',loadIdentity);
  assert.strictEqual(first,second);
  assert.equal(calls,1);
  assert.equal(requestIdentityCacheSize(),1);
  assert.equal(invalidateRequestContextCache({accessToken:'token-a'}),1);
});
