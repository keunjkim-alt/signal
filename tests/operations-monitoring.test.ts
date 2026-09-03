import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClientMetrics,summarizeOperationsMonitoring} from '../api/_lib/operations-monitoring.ts';

test('client telemetry removes unsafe fields and applies bounded values',()=>{
  const [metric]=normalizeClientMetrics([{type:'api<script>',name:'GET /api/ax/query\nsecret',durationMs:999999,page:'profitability<script>',status:'500',payload:{token:'never'}}]);
  assert.equal(metric.type,'apiscript');assert.equal(metric.name,'GET /api/ax/query secret');assert.equal(metric.durationMs,120000);assert.equal(metric.page,'profitabilityscript');assert.equal(metric.status,500);assert.equal('payload' in metric,false);
});

test('operations summary highlights source, import, API and AX risks',()=>{
  const summary=summarizeOperationsMonitoring({windowDays:7,telemetry:[{metadata:{entries:[
    {type:'api',name:'GET /api/dashboards/query?resource=inventory',durationMs:800,page:'inventory',status:200,at:'2026-09-03T00:00:00Z'},
    {type:'api',name:'POST /api/ax/query',durationMs:4200,page:'inventory',status:200,at:'2026-09-03T00:01:00Z'},
    {type:'api',name:'GET /api/integrations/sources',durationMs:1800,page:'connections',status:500,at:'2026-09-03T00:02:00Z'},
    {type:'navigation',name:'inventory',durationMs:280,page:'inventory',status:null,at:'2026-09-03T00:03:00Z'}
  ]}}],sources:[{name:'WMS',status:'error',data_mode:'stale'}],importJobs:[{id:'job-1',status:'failed'}],analyticsRuns:[{id:'run-1',status:'failed'}],auditEvents:[{action:'ax.router_fallback'}],axMessages:[{id:'message-1'}],queryCache:[{hit_count:4}]});
  assert.equal(summary.summary.apiRequests,3);assert.equal(summary.summary.apiErrors,1);assert.equal(summary.summary.slowApiRequests,2);assert.equal(summary.summary.axP95Ms,4200);assert.equal(summary.summary.navigationAverageMs,280);assert.equal(summary.summary.cacheHits,4);assert.ok(summary.attention.some(item=>item.title.includes('데이터 소스')));assert.ok(summary.attention.some(item=>item.title.includes('파일 적재')));assert.equal(summary.endpoints[0].p95Ms,4200);
});

test('healthy operations return one clear no-risk state',()=>{
  const summary=summarizeOperationsMonitoring({sources:[{status:'active',data_mode:'connected'}],telemetry:[],importJobs:[],analyticsRuns:[]});
  assert.deepEqual(summary.attention.map(item=>item.severity),['healthy']);
});
