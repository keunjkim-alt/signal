import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConversationSummary,emptyAxContext,finalizeAxContext,inheritedIntelligenceMode,isConversationSummaryIntent,modelConversationContext,removeAxContextField,resolveAxContextPlan,uniqueRowsByProduct} from '../api/_lib/ax-context.ts';

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

test('marketing intelligence preserves its campaign semantic plan',()=>{
  const previous=resolveAxContextPlan({question:'최근 30일 채널별 매출을 보여줘',page:'marketing',filters:{},plan:plan({metric:'net_sales',dimension:'channel',periodDays:30})}).context;
  const result=resolveAxContextPlan({previous,question:'현재 캠페인 중 예산을 조정해야 할 채널과 근거를 알려줘',page:'marketing',filters:{},plan:plan({metric:'marketing',dimension:'campaign',periodDays:31,source:'precomputed_marketing_metrics'})});
  assert.equal(result.plan.metric,'marketing');
  assert.equal(result.plan.dimension,'campaign');
  assert.match(result.context.summary,/캠페인 성과/);
  assert.match(result.context.summary,/캠페인별/);
});

test('a natural location refinement preserves product, metric, dimension, and period',()=>{
  const previous=resolveAxContextPlan({question:'FLOW-22-BLK-F 최근 14일 제품별 가용재고를 보여줘',page:'action',filters:{},plan:plan({metric:'available_qty',periodDays:14})}).context;
  const result=resolveAxContextPlan({previous,question:'강남점 기준으로만 다시 보여줘',page:'action',filters:{},plan:plan({metric:'net_sales',dimension:'channel',periodDays:14})});
  assert.equal(result.continuation,true);
  assert.equal(result.plan.metric,'available_qty');
  assert.equal(result.plan.dimension,'product');
  assert.equal(result.plan.periodDays,14);
  assert.equal(result.plan.filters.product,'FLOW-22-BLK-F');
  assert.equal(result.plan.filters.location,'강남');
});

test('a product pronoun continues the selected SKU',()=>{
  const previous=resolveAxContextPlan({question:'FLOW-22-BLK-F 최근 14일 제품별 가용재고를 보여줘',page:'action',filters:{},plan:plan({metric:'available_qty',periodDays:14})}).context;
  const result=resolveAxContextPlan({previous,question:'그 상품의 재주문 필요 수량과 미실행 위험은?',page:'action',filters:{},plan:plan({metric:'forecast',periodDays:14})});
  assert.equal(result.continuation,true);
  assert.equal(result.plan.metric,'forecast');
  assert.equal(result.plan.filters.product,'FLOW-22-BLK-F');
  assert.ok(result.inherited.includes('product'));
});

test('conversation summary intent creates a three-line contextual summary',()=>{
  const previous=finalizeAxContext(resolveAxContextPlan({question:'FLOW-22-BLK-F 최근 14일 제품별 재고를 보여줘',page:'action',filters:{},plan:plan({metric:'available_qty',periodDays:14})}).context,{rows:[{product_code:'FLOW-22-BLK-F'}]},'2026-09-06T00:00:00Z');
  assert.equal(isConversationSummaryIntent('지금까지 분석을 세 줄로 요약해줘'),true);
  const summary=buildConversationSummary(previous,[{role:'user',content:'그 상품의 재주문 필요 수량과 미실행 위험은?'}]);
  assert.equal(summary.lines.length,3);
  assert.match(summary.answer,/FLOW-22-BLK-F/);
  assert.match(summary.answer,/재주문 수량과 미실행 위험/);
});

test('forecast rows keep only the latest ordered result for each product',()=>{
  const rows=uniqueRowsByProduct([{product_code:'FLOW-22-BLK-F',forecast_quantity:839},{product_code:'FLOW-22-BLK-F',forecast_quantity:812},{product_code:'ARC-07',forecast_quantity:540}]);
  assert.deepEqual(rows.map(row=>[row.product_code,row.forecast_quantity]),[['FLOW-22-BLK-F',839],['ARC-07',540]]);
});
