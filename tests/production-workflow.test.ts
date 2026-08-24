import test from 'node:test';
import assert from 'node:assert/strict';
import {latestForecastRows,planningReorderQuantity} from '../api/dashboards/query.ts';

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
