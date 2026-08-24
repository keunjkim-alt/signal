import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inferMapping,parseCsv,validateAndNormalize} from '../api/_lib/wms.ts';

test('Korean WMS CSV headers are mapped and normalized',()=>{
  const rows=parseCsv('품번,창고코드,재고기준일,현재고,가용재고\nARC-07-BLK-M,WH-SEOUL,2026-08-13,120,95\n');
  const mapping=inferMapping(Object.keys(rows[0]));
  const result=validateAndNormalize(rows,mapping);
  assert.deepEqual(result.missingFields,[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows[0].sku_code,'ARC-07-BLK-M');
  assert.equal(result.validRows[0].location_code,'WH-SEOUL');
  assert.equal(result.validRows[0].available_qty,95);
});

test('invalid inventory rows are isolated',()=>{
  const rows=parseCsv('sku_code,location_code,snapshot_at,available_qty\nARC-07,,not-a-date,abc\n');
  const result=validateAndNormalize(rows,inferMapping(Object.keys(rows[0])));
  assert.equal(result.validRows.length,0);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].field_name,/location_code/);
});

test('production-like WMS fixture maps all required fields',()=>{
  const fixture=fileURLToPath(new URL('./fixtures/wms_inventory_e2e.csv',import.meta.url));
  const rows=parseCsv(readFileSync(fixture,'utf8'));
  const result=validateAndNormalize(rows,inferMapping(Object.keys(rows[0])));
  assert.deepEqual(result.missingFields,[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows.length,3);
  assert.equal(result.validRows.reduce((sum,row)=>sum+row.available_qty,0),636);
});
