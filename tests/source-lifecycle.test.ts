import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceLifecycleUpdate} from '../api/_lib/source-lifecycle.ts';

const source={status:'active',config:{entity_type:'sales_order'}};

test('data source can be paused and resumed without losing its configuration',()=>{
  const paused=sourceLifecycleUpdate(source,'pause','user-1','2026-08-27T01:00:00.000Z');
  assert.equal(paused.status,'paused');
  assert.equal(paused.config.entity_type,'sales_order');
  assert.equal(paused.config.lifecycle.paused_by,'user-1');
  const resumed=sourceLifecycleUpdate({...source,...paused},'resume','user-1','2026-08-27T02:00:00.000Z');
  assert.equal(resumed.status,'active');
  assert.equal(resumed.config.lifecycle.resumed_at,'2026-08-27T02:00:00.000Z');
});

test('archive is recoverable and restore leaves the source paused for review',()=>{
  const archived=sourceLifecycleUpdate(source,'archive','admin-1','2026-08-27T03:00:00.000Z');
  assert.equal(archived.status,'paused');
  assert.equal(archived.config.lifecycle.archived_by,'admin-1');
  const restored=sourceLifecycleUpdate({...source,...archived},'restore','admin-1','2026-08-27T04:00:00.000Z');
  assert.equal(restored.status,'paused');
  assert.equal(restored.config.lifecycle.archived_at,null);
  assert.equal(restored.config.lifecycle.restored_by,'admin-1');
});

test('an archived source cannot be resumed before restore',()=>{
  const archived=sourceLifecycleUpdate(source,'archive','admin-1');
  assert.throws(()=>sourceLifecycleUpdate({...source,...archived},'resume','admin-1'),/보관을 해제/);
});
