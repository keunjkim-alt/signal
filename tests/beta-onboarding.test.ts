import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {normalizeBulkPage} from '../api/permissions/bulk.ts';

test('current Korean navigation labels are accepted by beta bulk onboarding',()=>{
  assert.equal(normalizeBulkPage('오늘의 액션'),'action');
  assert.equal(normalizeBulkPage('승인·결정 관리'),'decisions');
  assert.equal(normalizeBulkPage('오늘 결정할 일'),'action');
  assert.equal(normalizeBulkPage('판매 현황'),'hub');
  assert.equal(normalizeBulkPage('목표·마감 전망'),'targets');
  assert.equal(normalizeBulkPage('목표·마감 예측'),'targets');
  assert.equal(normalizeBulkPage('이상·기회 신호'),'anomalies');
  assert.equal(normalizeBulkPage('지금 주목할 신호'),'anomalies');
  assert.equal(normalizeBulkPage('고객 인사이트'),'customers');
  assert.equal(normalizeBulkPage('사용자·권한'),'permissions');
});

test('beta operations templates are packaged with stable headers',()=>{
  const root=new URL('../assets/templates/closed-beta/',import.meta.url);
  const files={
    'VIIMsignal_Beta_User_Roster.csv':'이메일,이름,팀,역할,허용 페이지',
    'VIIMsignal_Beta_Field_Mapping.csv':'entity_type,standard_field,required',
    'VIIMsignal_Beta_Daily_Checklist.csv':'date,workspace,operator',
    'VIIMsignal_Beta_Feedback_Log.csv':'submitted_at,workspace,user_role'
  };
  for(const [name,header] of Object.entries(files))assert.ok(readFileSync(new URL(name,root),'utf8').startsWith(header),name);
});
