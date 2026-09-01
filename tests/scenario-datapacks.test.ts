import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferSalesMapping,validateAndNormalizeSales} from '../api/_lib/sales.ts';
import {inferMapping,parseCsv,validateAndNormalize} from '../api/_lib/wms.ts';

const fixture=(name:string)=>readFileSync(new URL(`../assets/templates/closed-beta/scenario-packs/${name}`,import.meta.url),'utf8');
const sales=(name:string)=>{const rows=parseCsv(fixture(name));return {rows,result:validateAndNormalizeSales(rows,inferSalesMapping(Object.keys(rows[0])))}};
const inventory=(name:string)=>{const rows=parseCsv(fixture(name));return {rows,result:validateAndNormalize(rows,inferMapping(Object.keys(rows[0])))}};

test('90-day baseline and 14-day event sales packs are fully importable',()=>{
  const baseline=sales('VIIMsignal_Pack1_Baseline_Sales_90D_v2.csv');
  const event=sales('VIIMsignal_Pack2_Event_Sales_14D_v2.csv');
  assert.equal(baseline.rows.length,6480);
  assert.equal(event.rows.length,1008);
  assert.equal(baseline.result.errors.length,0);
  assert.equal(event.result.errors.length,0);
  assert.deepEqual(baseline.result.missingFields,[]);
  assert.deepEqual(event.result.missingFields,[]);
  assert.equal(new Set(event.result.validRows.map(row=>row.channel_code)).size,6);
  assert.equal(event.result.validRows.reduce((sum,row)=>sum+row.returned_quantity,0),60);
  const baselineDates=baseline.result.validRows.map(row=>row.sold_at).sort(),eventDates=event.result.validRows.map(row=>row.sold_at).sort();
  assert.ok(baselineDates.at(-1)!<eventDates[0]);
  assert.equal(baselineDates.at(-1)?.slice(0,10),'2026-08-17');
  assert.equal(eventDates[0].slice(0,10),'2026-08-18');
});

test('baseline and event inventory packs cover the same 12 SKUs and seven locations',()=>{
  const baseline=inventory('VIIMsignal_Pack1_Baseline_Inventory_v2.csv');
  const event=inventory('VIIMsignal_Pack2_Event_Inventory_14D_v2.csv');
  const salesSkus=new Set(sales('VIIMsignal_Pack2_Event_Sales_14D_v2.csv').result.validRows.map(row=>row.sku_code));
  const inventorySkus=new Set(event.result.validRows.map(row=>row.sku_code));
  assert.equal(baseline.rows.length,84);
  assert.equal(event.rows.length,1176);
  assert.equal(baseline.result.errors.length,0);
  assert.equal(event.result.errors.length,0);
  assert.equal(inventorySkus.size,12);
  assert.equal(new Set(event.result.validRows.map(row=>row.location_code)).size,7);
  assert.deepEqual([...inventorySkus].sort(),[...salesSkus].sort());
});

test('latest inventory snapshot creates transfer, reorder and overstock decision signals',()=>{
  const rows=inventory('VIIMsignal_Pack2_Event_Inventory_14D_v2.csv').result.validRows.filter(row=>row.snapshot_at.startsWith('2026-08-31'));
  const find=(sku:string,location:string)=>rows.find(row=>row.sku_code===sku&&row.location_code===location)!;
  assert.ok(find('ARC-07-BLK-F','STORE-GANGNAM').available_qty<find('ARC-07-BLK-F','STORE-GANGNAM').safety_stock_qty);
  assert.ok(find('ARC-07-BLK-F','STORE-SEONGSU').available_qty>find('ARC-07-BLK-F','STORE-SEONGSU').safety_stock_qty*5);
  assert.ok(find('FLOW-22-BLK-F','STORE-BUSAN').available_qty<find('FLOW-22-BLK-F','STORE-BUSAN').safety_stock_qty);
  assert.ok(find('FLOW-22-BLK-F','STORE-HANNAM').available_qty>find('FLOW-22-BLK-F','STORE-HANNAM').safety_stock_qty*5);
  assert.ok(rows.filter(row=>row.sku_code==='AIR-24-NVY-F').every(row=>row.available_qty<row.safety_stock_qty));
  assert.ok(rows.filter(row=>row.sku_code==='MOSS-18-BLK-F').reduce((sum,row)=>sum+row.available_qty,0)>1000);
});

test('workflow reference pack defines priorities, actions and the production lifecycle',()=>{
  const scenarios=parseCsv(fixture('VIIMsignal_Pack3_Workflow_Scenarios.csv'));
  const production=parseCsv(fixture('VIIMsignal_Pack3_Production_Events.csv'));
  assert.equal(scenarios.length,8);
  assert.equal(scenarios.filter(row=>row.priority==='P0').length,4);
  assert.deepEqual(new Set(scenarios.map(row=>row.trigger_type)),new Set(['inventory_transfer','reorder','overstock_review','return_mitigation','production_progress','inbound_receipt']));
  assert.deepEqual(production.map(row=>row.production_status),['approved','planning','materials','cutting','sewing','inspection','completed']);
  assert.equal(production.at(-1)?.progress,'100');
});
