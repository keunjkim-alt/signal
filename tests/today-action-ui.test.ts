import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const decisions=readFileSync(new URL('../api/_lib/decision-actions.ts',import.meta.url),'utf8');

test('today action card uses decision-first language and integrated confidence',()=>{
  const card=app.slice(app.indexOf('function todayDecisionCard'),app.indexOf('function todayQueue'));
  assert.match(card,/todayDirective\(action,detail\)/);
  assert.match(card,/근거 수준/);
  assert.match(card,/오늘 결정하면/);
  assert.match(card,/결정을 미루면/);
  assert.doesNotMatch(card,/추천 신뢰도|판단 공식|action\.source/);
});

test('approval workflow distinguishes automatic creation from operator work',()=>{
  const flow=app.slice(app.indexOf('function todayExecutionFlow'),app.indexOf('function todaySummary'));
  assert.match(flow,/approve_transfer/);
  assert.match(flow,/재고 이동 요청과 출고·입고 건 생성/);
  assert.match(flow,/approve_reorder/);
  assert.match(flow,/생산 실행 큐에 생산오더 생성/);
  assert.match(flow,/mode:'자동'/);
  assert.match(flow,/mode:'담당자'/);
});

test('reorder copy states the business outcome in plain language',()=>{
  assert.match(decisions,/품절 없이.*판매 기회 확보/);
  assert.match(decisions,/생산기간 동안 필요한 판매 재고를 확보합니다/);
  assert.match(decisions,/다음 입고 전 판매 공백이 생길 수 있습니다/);
});
