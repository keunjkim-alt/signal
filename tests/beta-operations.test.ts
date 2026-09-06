import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBrandOnboardingChecklist,buildOperationalTask,deriveOperationalNotifications} from '../api/_lib/beta-operations.ts';
import {canTransitionTask} from '../api/_lib/operational-workflow.ts';

const now=new Date('2026-09-07T09:00:00+09:00');

test('approved return action becomes a real assigned task with due date and completion criteria',()=>{
  const task=buildOperationalTask({key:'today:return:ARC-07',kind:'return_mitigation',priority:'P0',title:'ARC-07 반품 개선',basis:'반품률 12.4%',due:'오늘 17:00',owner:'상품기획 · CS',target_page:'returns',execution:{action:'create_followup_task',taskType:'return_mitigation',targetPage:'returns',focus:'ARC-07',metrics:{returnRate:12.4}}},now);
  assert.equal(task.task_type,'return_mitigation');assert.equal(task.priority,'p0');assert.equal(task.status,'ready');assert.equal(task.metadata.action_key,'today:return:ARC-07');assert.equal(task.metadata.target_page,'returns');assert.match(task.due_at||'',/2026-09-07T08:00:00.000Z/);assert.equal(task.completion_criteria.length,3);
});

test('operational task workflow requires execution and verification before completion',()=>{
  assert.equal(canTransitionTask('ready','in_progress'),true);assert.equal(canTransitionTask('in_progress','verification'),true);assert.equal(canTransitionTask('verification','completed'),true);assert.equal(canTransitionTask('ready','completed'),false);
});

test('notifications prioritize undecided P0 and overdue execution work',()=>{
  const notifications=deriveOperationalNotifications({actions:[{key:'reorder',priority:'P0',decision_status:'proposed',title:'재주문 승인'}],tasks:[{id:'task-1',priority:'p1',status:'ready',title:'반품 개선',due_at:'2026-09-06T00:00:00Z',metadata:{target_page:'returns'}}],executions:[{id:'exec-1',status:'completed',execution_no:'VIIM-TR-001'}],outcomes:[]},now);
  assert.equal(notifications[0].priority,'p0');assert.ok(notifications.some(row=>row.id==='task:task-1:overdue'));assert.ok(notifications.some(row=>row.kind==='outcome'));
});

test('brand onboarding is gated by required operational datasets and reconciliation',()=>{
  const partial=buildBrandOnboardingChecklist({hasWorkspace:true,hasUsers:true,imports:[{entity_type:'product_master',status:'completed'},{entity_type:'sales_order',status:'completed'}],hasMapping:true,reconciliationReady:false});
  assert.equal(partial.ready,false);assert.deepEqual(partial.blockers,['위치별 재고','정합성 검사']);
  const ready=buildBrandOnboardingChecklist({hasWorkspace:true,hasUsers:true,imports:[{entity_type:'product_master',status:'completed'},{entity_type:'sales_order',status:'completed'},{entity_type:'inventory_snapshot',status:'completed'},{entity_type:'product_review',status:'completed'}],hasMapping:true,reconciliationReady:true});
  assert.equal(ready.ready,true);assert.equal(ready.percent,100);
});
