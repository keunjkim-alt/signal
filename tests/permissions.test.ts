import test from 'node:test';
import assert from 'node:assert/strict';
import {requirePagePermission,scopedValues} from '../api/_lib/supabase.ts';

const manager={membership:{role:'manager',data_scope:{countries:['KR'],channels:['자사몰','무신사'],locations:['STORE-GANGNAM']}},permissions:[{page_key:'inventory',can_view:true,can_update:true,can_approve:false}]};

test('page actions are checked independently',()=>{
  assert.doesNotThrow(()=>requirePagePermission(manager,'inventory','update'));
  assert.throws(()=>requirePagePermission(manager,'inventory','approve'),/Page permission required/);
  assert.throws(()=>requirePagePermission(manager,'profitability','view'),/Page permission required/);
});

test('requested filters cannot exceed account data scope',()=>{
  assert.deepEqual(scopedValues(manager,'countries'),['KR']);
  assert.deepEqual(scopedValues(manager,'channels','무신사'),['무신사']);
  assert.throws(()=>scopedValues(manager,'countries','CN'),/outside the account data scope/);
});
