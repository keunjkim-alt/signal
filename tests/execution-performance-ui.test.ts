import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [app,css,vercel]=await Promise.all([
  readFile(new URL('../app.js',import.meta.url),'utf8'),
  readFile(new URL('../execution-performance-v2.css',import.meta.url),'utf8'),
  readFile(new URL('../vercel.json',import.meta.url),'utf8')
]);

test('execution performance exposes a clear primary refresh action and tab counts',()=>{
  assert.match(app,/id="refreshExecutionOutcomes"/);
  assert.match(app,/성과 측정 업데이트/);
  assert.match(app,/실행 현황 <b>\$\{active\.length\}<\/b>/);
  assert.match(app,/완료·성과 <b>\$\{complete\.length\}<\/b>/);
  assert.match(css,/\.execution-page-intro/);
});

test('execution outcomes remain informative before measurements exist',()=>{
  assert.match(app,/아직 측정할 실행 성과가 없습니다/);
  assert.match(app,/안건 승인/);
  assert.match(app,/출고·입고 확인/);
  assert.match(app,/성과 자동 측정/);
  assert.match(app,/D\+7·14·28/);
});

test('production schedules automatic outcome measurement every day',()=>{
  const config=JSON.parse(vercel);
  assert.ok(config.crons.some((row:any)=>row.path==='/api/outcomes/cron'&&row.schedule==='0 22 * * *'));
  assert.match(app,/매일 07:00 자동 측정/);
});
