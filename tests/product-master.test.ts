import test from 'node:test';
import assert from 'node:assert/strict';
import {inferProductMapping,validateAndNormalizeProducts} from '../api/_lib/product-master.ts';

test('product master infers Korean columns and creates SKU fallback',()=>{
  const rows=[{품번:'abc-01',상품명:'테스트 재킷',카테고리:'아우터',정상가:'199,000',원가:'72,000'}],mapping=inferProductMapping(Object.keys(rows[0])),result=validateAndNormalizeProducts(rows,mapping);
  assert.deepEqual(result.missingFields,[]);assert.equal(result.validRows[0].product_code,'ABC-01');assert.equal(result.validRows[0].sku_code,'ABC-01');assert.equal(result.validRows[0].list_price,199000);
});

test('product master rejects rows without product name',()=>{
  const rows=[{product_code:'A-1',product_name:''}],mapping=inferProductMapping(Object.keys(rows[0])),result=validateAndNormalizeProducts(rows,mapping);
  assert.equal(result.validRows.length,0);assert.match(result.errors[0].message,/product_name/);
});
