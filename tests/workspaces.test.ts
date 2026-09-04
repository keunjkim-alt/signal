import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspaceInput,workspaceInsertPayload,workspaceUpdatePayload} from '../api/_lib/workspaces.ts';

test('workspace input is normalized for a safe tenant-scoped insert',()=>{assert.deepEqual(workspaceInsertPayload('org',{name:' 테스트 운영 ',code:'Pilot 01',timezone:'Asia/Seoul',isTest:true}),{organization_id:'org',brand_id:null,name:'테스트 운영',code:'pilot-01',status:'onboarding',service_stage:'setup',timezone:'Asia/Seoul',data_region:'ap-northeast-2',metadata:{test_data:true,created_from:'workspace_rail'}})});
test('workspace input rejects ambiguous short names and codes',()=>{assert.throws(()=>normalizeWorkspaceInput({name:'A',code:'a'}),/2~40자/)});
test('workspace profile update preserves metadata and normalizes description',()=>{const updated=workspaceUpdatePayload({name:' 운영 공간 ',code:'OPS',description:'  재고   운영 전용 ',isTest:false},{brand_id:'brand-1',timezone:'Asia/Seoul',metadata:{created_from:'workspace_rail',test_data:true}});assert.equal(updated.name,'운영 공간');assert.equal(updated.code,'ops');assert.equal(updated.description,'재고 운영 전용');assert.equal(updated.metadata.created_from,'workspace_rail');assert.equal(updated.metadata.test_data,false)});
