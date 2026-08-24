import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransferCandidates,latestInventoryRows,nextMovementStatus} from '../api/_lib/inventory-operations.ts';

test('latest inventory keeps only the newest row per sku and location',()=>{
  const rows=[
    {sku_id:'s1',location_id:'a',available_qty:90,snapshot_at:'2026-08-21'},
    {sku_id:'s1',location_id:'a',available_qty:60,snapshot_at:'2026-08-20'},
    {sku_id:'s1',location_id:'b',available_qty:10,snapshot_at:'2026-08-21'}
  ];
  assert.deepEqual(latestInventoryRows(rows).map(row=>row.available_qty),[90,10]);
});

test('transfer candidates move safe surplus toward the lowest stock location',()=>{
  const rows=[
    {sku_id:'s1',location_id:'a',available_qty:210,safety_stock_qty:50,snapshot_at:'2026-08-21'},
    {sku_id:'s1',location_id:'b',available_qty:10,safety_stock_qty:20,snapshot_at:'2026-08-21'}
  ];
  const [candidate]=buildTransferCandidates(rows,[]);
  assert.equal(candidate.from_location_id,'a');
  assert.equal(candidate.to_location_id,'b');
  assert.equal(candidate.recommended_qty,70);
});

test('active transfer prevents a duplicate recommendation',()=>{
  const rows=[{sku_id:'s1',location_id:'a',available_qty:210,safety_stock_qty:50},{sku_id:'s1',location_id:'b',available_qty:10,safety_stock_qty:20}];
  const existing=[{sku_id:'s1',from_location_id:'a',to_location_id:'b',status:'approved'}];
  assert.equal(buildTransferCandidates(rows,existing).length,0);
});

test('shipment status follows approval to transit to receipt',()=>{
  assert.equal(nextMovementStatus('approved'),'in_transit');
  assert.equal(nextMovementStatus('in_transit'),'received');
  assert.equal(nextMovementStatus('received'),null);
});
