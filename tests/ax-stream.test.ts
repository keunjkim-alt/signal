import test from 'node:test';
import assert from 'node:assert/strict';
import {answerChunks,encodeAxStreamEvent} from '../api/_lib/ax-stream.ts';
import {persistentDashboardCacheKey} from '../api/_lib/persistent-dashboard-cache.ts';

test('AX stream events are newline-delimited and retain Korean text',()=>{
  const line=encodeAxStreamEvent({type:'status',phase:'데이터를 조회하고 있습니다'});
  assert.equal(line.endsWith('\n'),true);
  assert.deepEqual(JSON.parse(line),{type:'status',phase:'데이터를 조회하고 있습니다'});
});

test('AX answers are split at natural sentence boundaries',()=>{
  assert.deepEqual(answerChunks('첫 결과입니다. 다음 행동을 제안합니다!'),['첫 결과입니다.','다음 행동을 제안합니다!']);
});

test('persistent dashboard snapshots are isolated by workspace and permission scope',()=>{
  const base={membership:{organization_id:'org-1',role:'manager',team_code:'sales',data_scope:{countries:['KR']}},workspace:{id:'workspace-1'},permissions:[{page_key:'hub',can_view:true,can_update:false,can_approve:false}]};
  const otherWorkspace={...base,workspace:{id:'workspace-2'}};
  const approver={...base,permissions:[{page_key:'hub',can_view:true,can_update:true,can_approve:true}]};
  assert.notEqual(persistentDashboardCacheKey(base,'sales-hub'),persistentDashboardCacheKey(otherWorkspace,'sales-hub'));
  assert.notEqual(persistentDashboardCacheKey(base,'sales-hub'),persistentDashboardCacheKey(approver,'sales-hub'));
});
