import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analysisDate,summarizePipelineResults} from '../api/_lib/post-import.ts';

test('analysis date follows the latest imported source date',()=>{
  assert.equal(analysisDate('2026-08-21T23:59:00+09:00'),'2026-08-21');
  assert.equal(analysisDate(null,new Date('2026-08-24T09:00:00Z')),'2026-08-24');
});

test('post import pipeline distinguishes completed, partial and failed runs',()=>{
  const completed=summarizePipelineResults([
    {key:'forecast',label:'예측',status:'completed'},
    {key:'discount',label:'할인',status:'completed'}
  ],'2026-08-24T00:00:00Z');
  assert.equal(completed.status,'completed');
  assert.equal(completed.completed,2);
  assert.equal(completed.failed,0);

  const partial=summarizePipelineResults([
    {key:'forecast',label:'예측',status:'completed'},
    {key:'discount',label:'할인',status:'failed',error:'no cost data'}
  ]);
  assert.equal(partial.status,'partial');
  assert.equal(partial.completed,1);
  assert.equal(partial.failed,1);

  const failed=summarizePipelineResults([
    {key:'forecast',label:'예측',status:'failed'},
    {key:'discount',label:'할인',status:'failed'}
  ]);
  assert.equal(failed.status,'failed');
});

test('post import implementation assigns legacy analytics to the active workspace',()=>{
  const source=fs.readFileSync(new URL('../api/_lib/post-import.ts',import.meta.url),'utf8');
  assert.match(source,/scopeLegacyAnalyticsResult/);
  assert.match(source,/forecast_snapshots/);
  assert.match(source,/discount_recommendation_snapshots/);
  assert.match(source,/workspace_id:workspaceId/);
});
