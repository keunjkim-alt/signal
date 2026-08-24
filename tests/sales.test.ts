import test from 'node:test';
import assert from 'node:assert/strict';
import {inferSalesMapping,validateAndNormalizeSales} from '../api/_lib/sales.ts';
import {parseCsv} from '../api/_lib/wms.ts';

test('Korean sales headers are mapped and normalized',()=>{
  const rows=parseCsv('판매일시,판매채널,상품코드,판매수량,결제금액,매장코드,주문번호\n2026-08-20 21:15,무신사,ARC-07-BLK-M,2,"248,000",ONLINE,ORD-100\n');
  const result=validateAndNormalizeSales(rows,inferSalesMapping(Object.keys(rows[0])));
  assert.deepEqual(result.missingFields,[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows[0].channel_code,'무신사');
  assert.equal(result.validRows[0].net_sales,248000);
  assert.equal(result.validRows[0].source_order_id,'ORD-100');
  assert.equal(result.validRows[0].sold_at,'2026-08-20T12:15:00.000Z');
});

test('sales validation isolates invalid rows',()=>{
  const rows=parseCsv('sold_at,channel_code,sku_code,quantity,net_sales\ninvalid,shop,SKU-1,0,abc\n2026-08-20,shop,SKU-2,1,120000\n');
  const result=validateAndNormalizeSales(rows,inferSalesMapping(Object.keys(rows[0])));
  assert.equal(result.validRows.length,1);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].field_name,/sold_at/);
  assert.match(result.errors[0].field_name,/quantity/);
});

test('fallback identities remain stable when sales amount changes',()=>{
  const first=parseCsv('sold_at,channel_code,sku_code,quantity,net_sales\n2026-08-20,shop,SKU-1,1,100000\n');
  const changed=parseCsv('sold_at,channel_code,sku_code,quantity,net_sales\n2026-08-20,shop,SKU-1,1,90000\n');
  const firstRow=validateAndNormalizeSales(first,inferSalesMapping(Object.keys(first[0]))).validRows[0];
  const changedRow=validateAndNormalizeSales(changed,inferSalesMapping(Object.keys(changed[0]))).validRows[0];
  assert.equal(firstRow.source_order_id,changedRow.source_order_id);
  assert.equal(firstRow.source_line_id,changedRow.source_line_id);
  assert.notEqual(firstRow.net_sales,changedRow.net_sales);
});

test('optional profitability fields are inferred and normalized without becoming required',()=>{
  const rows=parseCsv('판매일시,판매채널,상품코드,판매수량,결제금액,개당원가,채널수수료,마케팅비,배송비,반품처리비\n2026-08-24,자사몰,SKU-1,2,200000,45000,6000,8000,3500,1200\n');
  const mapping=inferSalesMapping(Object.keys(rows[0])),result=validateAndNormalizeSales(rows,mapping),row=result.validRows[0];
  assert.equal(mapping.unit_cost,'개당원가');
  assert.deepEqual(result.missingFields,[]);
  assert.deepEqual([row.unit_cost,row.channel_fee,row.marketing_cost,row.shipping_cost,row.return_cost],[45000,6000,8000,3500,1200]);
});

test('closed beta customer, region and return fields are preserved without direct identity data',()=>{
  const rows=parseCsv('판매일시,판매채널,상품코드,판매수량,결제금액,반품수량,익명고객ID,배송시도,배송시군구,주문상태\n2026-08-24,자사몰,SKU-1,2,200000,1,CUST-001,서울,성동구,결제완료\n');
  const mapping=inferSalesMapping(Object.keys(rows[0])),result=validateAndNormalizeSales(rows,mapping),row=result.validRows[0];
  assert.deepEqual([row.returned_quantity,row.customer_token,row.shipping_region_1,row.shipping_region_2,row.order_status],[1,'CUST-001','서울','성동구','paid']);
});

test('returned quantity is capped at sold quantity and cancelled status is normalized',()=>{
  const rows=parseCsv('sold_at,channel_code,sku_code,quantity,net_sales,returned_quantity,order_status\n2026-08-24,shop,SKU-1,2,0,7,cancelled\n');
  const row=validateAndNormalizeSales(rows,inferSalesMapping(Object.keys(rows[0]))).validRows[0];
  assert.equal(row.returned_quantity,2);
  assert.equal(row.order_status,'cancelled');
});

test('ISO timestamps with milliseconds remain valid',()=>{
  const rows=parseCsv('sold_at,channel_code,sku_code,quantity,net_sales\n2026-08-23T10:00:00.000Z,shop,SKU-1,1,100000\n');
  const result=validateAndNormalizeSales(rows,inferSalesMapping(Object.keys(rows[0])));
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows[0].sold_at,'2026-08-23T10:00:00.000Z');
});
