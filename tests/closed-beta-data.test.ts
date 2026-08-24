import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferSalesMapping,validateAndNormalizeSales} from '../api/_lib/sales.ts';
import {inferMapping,parseCsv,validateAndNormalize} from '../api/_lib/wms.ts';

const fixture=(name:string)=>readFileSync(new URL(`../assets/templates/closed-beta/${name}`,import.meta.url),'utf8');

test('closed beta sales pack is fully importable and covers decision data',()=>{
  const rows=parseCsv(fixture('VIIMsignal_Closed_Beta_Sales_30D.csv')),mapping=inferSalesMapping(Object.keys(rows[0])),result=validateAndNormalizeSales(rows,mapping);
  assert.equal(rows.length,1440);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows.length,1440);
  assert.deepEqual(result.missingFields,[]);
  for(const field of ['unit_cost','channel_fee','marketing_cost','returned_quantity','customer_token','shipping_region_1','shipping_region_2','order_status'])assert.ok(mapping[field],`${field} mapping`);
  assert.ok(new Set(result.validRows.map(row=>row.channel_code)).size>=6);
  assert.ok(new Set(result.validRows.map(row=>row.customer_token)).size>=300);
  assert.ok(result.validRows.some(row=>row.returned_quantity>0));
  assert.equal(new Set(result.validRows.map(row=>row.location_code)).size,7);
});

test('closed beta inventory pack matches every sales SKU and is fully importable',()=>{
  const salesRows=parseCsv(fixture('VIIMsignal_Closed_Beta_Sales_30D.csv')),inventoryRows=parseCsv(fixture('VIIMsignal_Closed_Beta_Inventory.csv')),result=validateAndNormalize(inventoryRows,inferMapping(Object.keys(inventoryRows[0]))),salesSkus=new Set(salesRows.map(row=>row.sku_code)),inventorySkus=new Set(result.validRows.map(row=>row.sku_code));
  assert.equal(inventoryRows.length,56);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows.length,56);
  assert.deepEqual(result.missingFields,[]);
  assert.deepEqual([...inventorySkus].sort(),[...salesSkus].sort());
  assert.equal(new Set(result.validRows.map(row=>row.location_code)).size,7);
});
