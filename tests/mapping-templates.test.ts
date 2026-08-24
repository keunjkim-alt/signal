import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseMapping,headerSignature,requiredMappingFields,sanitizeMapping} from '../api/_lib/mapping-templates.ts';

test('header signature is stable when company file column order changes',async()=>{
  const first=await headerSignature(['판매일시','상품코드','수량','결제금액']);
  const reordered=await headerSignature(['결제금액','수량','판매일시','상품코드']);
  assert.equal(first,reordered);
  assert.match(first,/^sha256:[a-f0-9]{64}$/);
});

test('saved company mapping wins over alias inference and fills new inferred fields',()=>{
  const headers=['거래시각','판매처','스타일번호','판매개수','실결제','매장명'],inferred={location_name:'매장명'},saved={sold_at:'거래시각',channel_code:'판매처',sku_code:'스타일번호',quantity:'판매개수',net_sales:'실결제'};
  const choice=chooseMapping('sales_order',headers,{},saved,inferred);
  assert.equal(choice.source,'saved_template');
  assert.deepEqual(choice.mapping,{location_name:'매장명',...saved});
  assert.deepEqual(requiredMappingFields('sales_order').filter(field=>!choice.mapping[field]),[]);
});

test('manual mapping overrides a saved template while invalid source columns are removed',()=>{
  const headers=['일시','채널','품번','수량','금액'],saved={sold_at:'일시',channel_code:'채널',sku_code:'품번',quantity:'수량',net_sales:'금액'},requested={net_sales:'금액',sku_code:'없는컬럼'};
  const choice=chooseMapping('sales_order',headers,requested,saved,saved);
  assert.equal(choice.source,'request');
  assert.equal(choice.mapping.net_sales,'금액');
  assert.equal(choice.mapping.sku_code,'품번');
  assert.deepEqual(sanitizeMapping('sales_order',headers,{sku_code:'없는컬럼',unknown:'일시'}),{});
});
