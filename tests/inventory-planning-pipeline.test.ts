import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInternalInventoryPlan} from '../api/_lib/inventory-planning-pipeline.ts';

const day=(offset:number)=>{const date=new Date('2026-09-01T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString()};

test('internal planning pipeline creates daily forecasts, positions and a constrained transfer',()=>{
  const orders:any[]=[],lines:any[]=[];
  for(let offset=-28;offset<0;offset++)for(const [location,quantity] of [['DC',1],['STORE',5]] as const){const id=`${location}-${offset}`;orders.push({id,location_id:location,ordered_at:day(offset)});lines.push({order_id:id,sku_id:'SKU-1',quantity,returned_quantity:0,unit_sale_price:100,unit_cost:40})}
  const plan=buildInternalInventoryPlan({
    asOfDate:'2026-09-01',horizonDays:7,historyDays:28,orders,lines,
    snapshots:[{sku_id:'SKU-1',location_id:'DC',snapshot_at:day(0),available_qty:100},{sku_id:'SKU-1',location_id:'STORE',snapshot_at:day(0),available_qty:0}],
    inboundOrders:[{id:'IN-1',destination_location_id:'STORE',status:'confirmed'}],inboundLines:[{inbound_order_id:'IN-1',sku_id:'SKU-1',ordered_qty:10,received_qty:0,cancelled_qty:0}],transfers:[],
    policies:[{status:'active',effective_from:'2026-01-01',sku_id:'SKU-1',allow_rebalancing:true,order_pack_qty:5,min_transfer_qty:5,safety_stock_days:2}],
    routes:[{status:'active',from_location_id:'DC',to_location_id:'STORE',min_shipment_qty:5,fixed_cost:10,variable_cost_per_unit:1}]
  });
  assert.equal(plan.readiness.ready,true);assert.equal(plan.positions.length,2);assert.equal(plan.forecasts.length,14);assert.equal(plan.recommendations.length,1);assert.equal(plan.recommendations[0].recommendedQty,25);assert.equal(plan.positions.find(row=>row.location_id==='STORE').inventory_position_qty,10);
});

test('internal planning pipeline persists forecasts but withholds recommendations when policies or routes are missing',()=>{
  const plan=buildInternalInventoryPlan({asOfDate:'2026-09-01',horizonDays:3,snapshots:[{sku_id:'S1',location_id:'A',snapshot_at:day(0),available_qty:10}],orders:[],lines:[],policies:[],routes:[]});
  assert.equal(plan.positions.length,1);assert.equal(plan.forecasts.length,3);assert.deepEqual(plan.recommendations,[]);assert.deepEqual(plan.readiness.missing,['inventory_policies','logistics_routes']);
});

test('an applied learning profile conservatively changes the next internal forecast',()=>{
  const base:any={asOfDate:'2026-09-01',historyDays:28,horizonDays:7,workspaceId:'workspace',orders:Array.from({length:28},(_,index)=>({id:`o${index}`,location_id:'store',ordered_at:new Date(Date.UTC(2026,7,4+index)).toISOString()})),lines:Array.from({length:28},(_,index)=>({order_id:`o${index}`,sku_id:'sku',quantity:10,returned_quantity:0,unit_sale_price:100,unit_cost:40})),snapshots:[{sku_id:'sku',location_id:'store',snapshot_at:'2026-08-31',available_qty:10}],policies:[],routes:[]};
  const normal=buildInternalInventoryPlan(base),learned=buildInternalInventoryPlan({...base,learningProfiles:[{skuId:'sku',locationId:'store',multiplier:1.1,confidence:.7,evidenceCount:4}]});
  assert.ok(learned.forecasts[0].p50_qty>normal.forecasts[0].p50_qty);assert.equal(learned.forecasts[0].diagnostics.learning_multiplier,1.1);assert.equal(learned.learning.appliedProfiles,1);
});
