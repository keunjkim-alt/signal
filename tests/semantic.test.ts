import test from 'node:test';
import assert from 'node:assert/strict';
import {heuristicPlan,intelligenceMode,normalizeQuerySpec} from '../api/_lib/semantic.ts';

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
  assert.deepEqual(plan.filters,{country:'KR',channel:'무신사',platform:null});
});

test('market ranking questions use precomputed external market metrics',()=>{
  const plan=heuristicPlan('외부 플랫폼 브랜드 순위를 보여줘','market');
  assert.equal(plan.metric,'best_rank');
  assert.equal(plan.dimension,'platform');
});

test('forecast and product matching questions route to stored intelligence snapshots',()=>{
  assert.equal(intelligenceMode('ARC-07의 2주 수요 예측과 재주문 수량을 보여줘','inventory'),'forecast');
  assert.equal(intelligenceMode('자사 상품과 유사한 경쟁 상품을 매칭해줘','market'),'matching');
  assert.equal(intelligenceMode('오늘 채널별 매출을 보여줘','hub'),null);
});

test('discount optimization questions use saved recommendation snapshots',()=>{
  assert.equal(intelligenceMode('ARC-07의 최적 할인율을 추천해줘','profitability'),'discount');
  assert.equal(intelligenceMode('할인 없이 정상가 판매를 유지할 제품은?','profitability'),'discount');
});
