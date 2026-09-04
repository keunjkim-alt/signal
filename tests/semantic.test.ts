import test from 'node:test';
import assert from 'node:assert/strict';
import {heuristicPlan,intelligenceMode,normalizeQuerySpec,requiresOpenAI} from '../api/_lib/semantic.ts';

test('inventory questions select an inventory metric and product dimension',()=>{
  const plan=heuristicPlan('7일 내 품절 위험 재고 제품을 보여줘','inventory');
  assert.equal(plan.metric,'available_qty');
  assert.equal(plan.dimension,'product');
  assert.equal(plan.visualization,'bar');
});

test('dashboard specifications reject arbitrary metrics and clamp limits',()=>{
  const plan=normalizeQuerySpec({metric:'drop table users',dimension:'sql',limit:5000,periodDays:-3});
  assert.equal(plan.metric,'net_sales');
  assert.equal(plan.dimension,'channel');
  assert.equal(plan.limit,100);
  assert.equal(plan.periodDays,1);
});

test('country labels are normalized to ISO codes',()=>{
  const plan=normalizeQuerySpec({filters:{country:'한국',channel:'무신사'}});
  assert.deepEqual(plan.filters,{country:'KR',channel:'무신사',platform:null,location:null,product:null});
});

test('market ranking questions use precomputed external market metrics',()=>{
  const plan=heuristicPlan('외부 플랫폼 브랜드 순위를 보여줘','market');
  assert.equal(plan.metric,'best_rank');
  assert.equal(plan.dimension,'platform');
});

test('inventory priority is not mistaken for an external market ranking',()=>{
  const plan=heuristicPlan('현재 재고 이동 승인 대기 중 우선순위 3건과 근거를 알려줘','inventory');
  assert.equal(plan.metric,'available_qty');
  assert.equal(plan.dimension,'product');
});

test('forecast and product matching questions route to stored intelligence snapshots',()=>{
  assert.equal(intelligenceMode('ARC-07의 2주 수요 예측과 재주문 수량을 보여줘','inventory'),'forecast');
  assert.equal(intelligenceMode('자사 상품과 유사한 경쟁 상품을 매칭해줘','market'),'matching');
  assert.equal(intelligenceMode('오늘 채널별 매출을 보여줘','hub'),null);
  assert.equal(intelligenceMode('반품률이 높은 제품의 근거를 보여줘','action'),'returns');
  assert.equal(intelligenceMode('성동구 재구매 고객을 분석해줘','action'),'customer');
});

test('discount optimization questions use saved recommendation snapshots',()=>{
  assert.equal(intelligenceMode('ARC-07의 최적 할인율을 추천해줘','profitability'),'discount');
  assert.equal(intelligenceMode('할인 없이 정상가 판매를 유지할 제품은?','profitability'),'discount');
});

test('production questions route to the real approved reorder execution queue',()=>{
  assert.equal(intelligenceMode('생산오더 중 납기 위험과 다음 실행을 근거와 함께 보여줘','production'),'production');
  assert.equal(intelligenceMode('검품 지연 공정을 보여줘','action'),'production');
});

test('routine recommendations stay on the fast deterministic route',()=>{
  assert.equal(requiresOpenAI('오늘 가장 먼저 실행할 재고 이동을 추천해줘'),false);
  assert.equal(requiresOpenAI('제품별 다음 주 판매량을 예측해줘'),false);
  assert.equal(requiresOpenAI('오늘 판매 현황을 요약해줘'),false);
  assert.equal(requiresOpenAI('매출이 감소한 원인을 설명해줘'),true);
});
