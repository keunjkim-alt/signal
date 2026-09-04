import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyAxContext,finalizeAxContext,inheritedIntelligenceMode,modelConversationContext,removeAxContextField,resolveAxContextPlan} from '../api/_lib/ax-context.ts';

const plan=(overrides:any={})=>({metric:'quantity',dimension:'product',visualization:'bar',periodDays:30,filters:{country:null,channel:null,platform:null,location:null,product:null},limit:20,title:'제품 판매수량',explanation:'제품별 판매수량을 조회합니다.',source:'heuristic',...overrides});

test('a short follow-up inherits the previous analysis and changes only location',()=>{
  const previous=resolveAxContextPlan({question:'최근 30일 제품별 판매수량을 보여줘',page:'hub',filters:{},plan:plan()}).context;
  const result=resolveAxContextPlan({previous,question:'그중 서울 매장만',page:'hub',filters:{},plan:plan({metric:'net_sales',dimension:'location',periodDays:14})});
  assert.equal(result.plan.metric,'quantity');
  assert.equal(result.plan.dimension,'location');
  assert.equal(result.plan.periodDays,30);
  assert.equal(result.plan.filters.location,'서울');
  assert.ok(result.inherited.includes('metric'));
  assert.ok(result.inherited.includes('periodDays'));
});

test('an explicit period overrides inherited context without losing the product',()=>{
  const previous=resolveAxContextPlan({question:'ARC-07 최근 30일 판매수량',page:'hub',filters:{},plan:plan()}).context;
  const result=resolveAxContextPlan({previous,question:'최근 7일로 바꿔줘',page:'hub',filters:{},plan:plan({periodDays:7})});
  assert.equal(result.plan.periodDays,7);
  assert.equal(result.plan.filters.product,'ARC-07');
  assert.ok(result.inherited.includes('product'));
});

test('current page filters take precedence over inherited filters',()=>{
  const previous=resolveAxContextPlan({question:'무신사 판매량',page:'hub',filters:{},plan:plan()}).context;
  const result=resolveAxContextPlan({previous,question:'제품별로 보여줘',page:'hub',filters:{channel:'29CM'},plan:plan()});
  assert.equal(result.plan.filters.channel,'29CM');
  assert.equal(result.plan.dimension,'product');
});

test('condition reset removes inherited state',()=>{
  const previous=resolveAxContextPlan({question:'ARC-07 무신사 최근 30일 판매수량',page:'hub',filters:{},plan:plan()}).context;
  const result=resolveAxContextPlan({previous,question:'조건 초기화하고 채널별 매출을 보여줘',page:'hub',filters:{},plan:plan({metric:'net_sales',dimension:'channel',periodDays:14})});
  assert.equal(result.reset,true);
  assert.equal(result.plan.filters.product,null);
  assert.equal(result.plan.filters.channel,null);
  assert.deepEqual(result.inherited,[]);
});

test('stored model context is bounded to eight short messages',()=>{
  const messages=Array.from({length:12},(_,index)=>({role:index%2?'assistant':'user',content:`${index} ${'가'.repeat(600)}`}));
  const context=modelConversationContext(resolveAxContextPlan({question:'제품별 판매량',page:'hub',filters:{},plan:plan()}).context,messages);
  assert.equal(context.recentMessages.length,8);
  assert.ok(context.recentMessages.every((message:any)=>message.content.length<=400));
});

test('removing one field preserves the rest and result summary stores only top keys',()=>{
  const previous=resolveAxContextPlan({question:'ARC-07 무신사 최근 30일 판매수량',page:'hub',filters:{},plan:plan()}).context;
  const removed=removeAxContextField(previous,'channel');
  assert.equal(removed.filters.channel,null);
  assert.equal(removed.filters.product,'ARC-07');
  const finalized=finalizeAxContext(removed,{rows:[{product_code:'ARC-07'},{product_code:'FLOW-22'}]},'2026-09-04T00:00:00Z');
  assert.deepEqual(finalized.lastResultSummary,{rowCount:2,topKeys:['ARC-07','FLOW-22'],watermark:'2026-09-04T00:00:00Z'});
});

test('empty context has no cross-conversation filters',()=>{
  const context=emptyAxContext('inventory');
  assert.equal(context.pageKey,'inventory');
  assert.deepEqual(context.filters,{country:null,channel:null,platform:null,location:null,product:null});
});

test('a short follow-up stays on the previous precomputed intelligence route',()=>{
  const previous=resolveAxContextPlan({question:'제품별 14일 수요예측을 보여줘',page:'lifecycle',filters:{},plan:plan({metric:'forecast',periodDays:14})}).context;
  assert.equal(inheritedIntelligenceMode(null,'그중 ARC-07만',previous),'forecast');
  assert.equal(inheritedIntelligenceMode('discount','할인 추천',previous),'discount');
  assert.equal(inheritedIntelligenceMode(null,'새로운 고객 분석을 상세히 설명해줘',previous),null);
});
