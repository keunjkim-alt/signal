import test from 'node:test';
import assert from 'node:assert/strict';
import {canTransitionAttention,canTransitionTask,evaluateOperationalEvent,eventDedupeKey,resolutionRequirements} from '../api/_lib/operational-workflow.ts';

test('sync failure becomes a scoped attention item with data operations SLA',()=>{
  const result=evaluateOperationalEvent({event_type:'sync.failed',severity:'warning',object_type:'data_source',object_id:'src-1',payload:{}},new Date('2026-08-28T00:00:00Z'));
  assert.equal(result.createAttention,true);if(!result.createAttention)return;
  assert.equal(result.assignedTeam,'data_ops');assert.equal(result.category,'data');assert.equal(result.responseDueAt,'2026-08-28T00:30:00.000Z');assert.equal(result.incident,null);
});

test('cross-workspace sync failure is promoted to a P0 incident',()=>{
  const result=evaluateOperationalEvent({event_type:'sync.failed',severity:'warning',object_type:'pipeline',object_id:'pos',payload:{retry_exhausted:true,affected_workspaces:4}},new Date('2026-08-28T00:00:00Z'));
  assert.equal(result.createAttention,true);if(!result.createAttention)return;
  assert.equal(result.severity,'critical');assert.equal(result.incident,'p0');assert.equal(result.priority,'p0');assert.equal(result.responseDueAt,'2026-08-28T00:15:00.000Z');
});

test('unmapped and informational events do not create noisy attention items',()=>{
  assert.deepEqual(evaluateOperationalEvent({event_type:'sync.succeeded',severity:'info'}),{createAttention:false,reason:'unmapped_event'});
  assert.deepEqual(evaluateOperationalEvent({event_type:'adoption.dropped',severity:'info',payload:{}}),{createAttention:false,reason:'informational'});
});

test('event identity stays stable for repeated delivery',()=>{
  assert.equal(eventDedupeKey({correlation_id:'run-42'}),'run-42');
  assert.equal(eventDedupeKey({event_type:'sync.failed',object_type:'source',object_id:'a'}),'sync.failed:source:a');
});

test('attention and task transitions enforce verification before completion',()=>{
  assert.equal(canTransitionAttention('open','acknowledged'),true);assert.equal(canTransitionAttention('open','resolved'),false);
  assert.equal(canTransitionTask('in_progress','verification'),true);assert.equal(canTransitionTask('in_progress','completed'),false);assert.equal(canTransitionTask('verification','completed'),true);
});

test('resolution requires source recovery and a written record',()=>{
  assert.deepEqual(resolutionRequirements({sourceHealthy:false,resolutionNote:''}),{ready:false,missing:['sourceHealthy','resolutionNote']});
  assert.deepEqual(resolutionRequirements({sourceHealthy:true,resolutionNote:'재처리와 지표 검증 완료'}),{ready:true,missing:[]});
  assert.deepEqual(resolutionRequirements({sourceHealthy:false,manualOverride:true,resolutionNote:'고객 승인으로 종료'}),{ready:true,missing:[]});
});
