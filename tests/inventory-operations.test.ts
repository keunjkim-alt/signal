import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransferCandidates,latestInventoryRows,nextMovementStatus,summarizeInventorySnapshot} from '../api/_lib/inventory-operations.ts';

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

test('inventory dashboard summarizes latest WMS rows with recent sales velocity',()=>{
  const result=summarizeInventorySnapshot({
    snapshots:[
      {sku_id:'s1',location_id:'l1',available_qty:84,snapshot_at:'2026-08-21T09:00:00Z'},
      {sku_id:'s1',location_id:'l1',available_qty:120,snapshot_at:'2026-08-20T09:00:00Z'},
      {sku_id:'s1',location_id:'l2',available_qty:28,snapshot_at:'2026-08-21T09:00:00Z'}
    ],
    skus:[{id:'s1',sku_code:'ARC-07-BLK-F',product_id:'p1'}],
    products:[{id:'p1',product_code:'ARC-07',product_name:'아카이브 재킷',image_url:'/arc.jpg'}],
    locations:[{id:'l1',location_code:'GANGNAM',location_name:'강남점',country_code:'KR'},{id:'l2',location_code:'SEONGSU',location_name:'성수점',country_code:'KR'}],
    orders:[{id:'o1',location_id:'l1',country_code:'KR',channel_code:'매장 POS'},{id:'o2',location_id:'l2',country_code:'KR',channel_code:'매장 POS'}],
    lines:[{order_id:'o1',sku_id:'s1',quantity:14},{order_id:'o2',sku_id:'s1',quantity:14}],
    periodDays:14
  });
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].available_qty,112);
  assert.equal(result.products[0].inventory_cover_days,56);
  assert.equal(result.products[0].sell_through_rate,20);
  assert.deepEqual(result.locations.map(row=>[row.label,row.inventory_cover_days]),[['강남점',84],['성수점',28]]);
  assert.equal(result.latestSnapshotAt,'2026-08-21T09:00:00Z');
});

test('inventory dashboard applies company location and country scope',()=>{
  const result=summarizeInventorySnapshot({
    snapshots:[{sku_id:'s1',location_id:'kr',available_qty:30,snapshot_at:'2026-08-21'},{sku_id:'s1',location_id:'cn',available_qty:80,snapshot_at:'2026-08-21'}],
    skus:[{id:'s1',sku_code:'S1'}],products:[],
    locations:[{id:'kr',location_code:'SEOUL',location_name:'서울',country_code:'KR'},{id:'cn',location_code:'SHANGHAI',location_name:'상하이',country_code:'CN'}],
    orders:[],lines:[],allowedCountries:['KR'],allowedLocations:['SEOUL']
  });
  assert.equal(result.products[0].available_qty,30);
  assert.deepEqual(result.locations.map(row=>row.label),['서울']);
});
