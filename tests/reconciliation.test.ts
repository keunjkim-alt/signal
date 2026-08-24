import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferSalesMapping,validateAndNormalizeSales} from '../api/_lib/sales.ts';
import {inferMapping,parseCsv,validateAndNormalize} from '../api/_lib/wms.ts';
import {buildReconciliation,inventoryControlTotals,salesControlTotals} from '../api/_lib/reconciliation.ts';

const fixture=(name:string)=>readFileSync(new URL(`../assets/templates/closed-beta/${name}`,import.meta.url),'utf8');

test('sales controls reconcile the closed beta source and persisted shape',()=>{
  const source=parseCsv(fixture('VIIMsignal_Closed_Beta_Sales_30D.csv')),normalized=validateAndNormalizeSales(source,inferSalesMapping(Object.keys(source[0]))).validRows,sourceTotals=salesControlTotals(normalized),persisted=normalized.map(row=>({order_id:row.source_order_id,sku_id:row.sku_code,quantity:row.quantity,returned_quantity:row.returned_quantity,net_sales:row.net_sales})),result=buildReconciliation('sales_order',sourceTotals,salesControlTotals(persisted));
  assert.equal(sourceTotals.rows,1440);
  assert.ok(sourceTotals.quantity>0);
  assert.ok(sourceTotals.netSales>0);
  assert.equal(result.status,'matched');
  assert.ok(result.checks.every(check=>check.match));
});

test('inventory controls reconcile the closed beta source and persisted shape',()=>{
  const source=parseCsv(fixture('VIIMsignal_Closed_Beta_Inventory.csv')),normalized=validateAndNormalize(source,inferMapping(Object.keys(source[0]))).validRows,sourceTotals=inventoryControlTotals(normalized),persisted=normalized.map(row=>({sku_id:row.sku_code,location_id:row.location_code,on_hand_qty:row.on_hand_qty,reserved_qty:row.reserved_qty,available_qty:row.available_qty})),result=buildReconciliation('inventory_snapshot',sourceTotals,inventoryControlTotals(persisted));
  assert.equal(sourceTotals.rows,56);
  assert.equal(sourceTotals.locations,7);
  assert.equal(result.status,'matched');
});

test('reconciliation reports the exact mismatched measure',()=>{
  const result=buildReconciliation('sales_order',{rows:10,orders:8,skus:3,quantity:12,returnedQuantity:1,netSales:100000},{rows:10,orders:8,skus:3,quantity:11,returnedQuantity:1,netSales:100000}),quantity=result.checks.find(check=>check.key==='quantity');
  assert.equal(result.status,'mismatch');
  assert.equal(quantity.match,false);
  assert.equal(quantity.difference,-1);
});
