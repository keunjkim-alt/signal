import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReorderPayload,latestForecastRows,planningReorderQuantity,productionOrdersFromRecommendations,reorderIntegrityIssues} from '../api/dashboards/query.ts';

test('latest forecast keeps the newest generated horizon per product',()=>{
  const rows=[
    {subject_key:'p1',generated_at:'2026-08-21T10:00:00Z',horizon_days:28,confidence:.82,predictions:{product_code:'ARC-07',forecast_quantity:2800,recommended_reorder_qty:900}},
    {subject_key:'p1',generated_at:'2026-08-20T10:00:00Z',horizon_days:14,confidence:.78,predictions:{product_code:'ARC-07',forecast_quantity:1400,recommended_reorder_qty:0}},
    {subject_key:'p2',generated_at:'2026-08-21T10:00:00Z',horizon_days:28,confidence:.74,predictions:{product_code:'FLOW-22',forecast_quantity:1800,recommended_reorder_qty:600}}
  ];
  const result=latestForecastRows(rows);
  assert.equal(result.length,2);
  assert.equal(result[0].product_code,'ARC-07');
  assert.equal(result[0].horizon_days,28);
  assert.equal(result[0].recommended_reorder_qty,900);
});

test('planning reorder protects the forecast horizon plus production lead time',()=>{
  const row={horizon_days:28,forecast_quantity:2800,available_qty:3000,safety_stock_qty:200,recommended_reorder_qty:0};
  assert.equal(planningReorderQuantity(row,14),1400);
});

test('approved reorder without an execution payload is detected and can be repaired',()=>{
  const orphan={id:'rec-1',conversation_id:'conv-1',recommendation_key:'reorder:ARC-07',page_key:'inventory',title:'ARC-07 1,091pcs 재주문',status:'approved',payload:{query:'재주문 승인'},approved_at:'2026-08-21T10:00:00Z'};
  const forecast={product_code:'ARC-07',product_name:'Utility Jacket',forecast_quantity:727,forecast_net_sales:165000000,available_qty:0,confidence:.5,horizon_days:28};
  const [issue]=reorderIntegrityIssues([orphan],[forecast]);
  assert.equal(issue.product_code,'ARC-07');
  assert.equal(issue.quantity,1091);
  const payload=buildReorderPayload({productCode:issue.product_code,productName:forecast.product_name,quantity:issue.quantity,forecast,existingPayload:issue.payload,now:'2026-08-25T00:00:00Z'});
  assert.equal(payload.kind,'reorder');
  assert.equal(payload.production_status,'approved');
  assert.equal(payload.quantity,1091);
  const orders=productionOrdersFromRecommendations([{...orphan,payload}],[{product_code:'ARC-07',product_name:'Utility Jacket'}]);
  assert.equal(orders.length,1);
  assert.equal(orders[0].quantity,1091);
  assert.equal(orders[0].product_code,'ARC-07');
});

test('valid reorder execution payload is not reported as an integrity issue',()=>{
  const payload=buildReorderPayload({productCode:'FLOW-22',quantity:1200,forecast:{product_code:'FLOW-22'},now:'2026-08-25T00:00:00Z'});
  const recommendation={id:'rec-2',recommendation_key:'reorder:FLOW-22',page_key:'inventory',title:'FLOW-22 1,200pcs 재주문',status:'approved',payload};
  assert.equal(reorderIntegrityIssues([recommendation],[]).length,0);
});
