import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCustomerInsights,summarizeReturnInsights} from '../api/_lib/customer-returns.ts';

const orders=[
  {id:'o1',customer_token:'c1',ordered_at:'2026-08-01',status:'paid',paid_amount:100000,channel_code:'자사몰',shipping_region_1:'서울',shipping_region_2:'성동구'},
  {id:'o2',customer_token:'c1',ordered_at:'2026-08-11',status:'paid',paid_amount:150000,channel_code:'자사몰',shipping_region_1:'서울',shipping_region_2:'성동구'},
  {id:'o3',customer_token:'c2',ordered_at:'2026-08-12',status:'cancelled',paid_amount:0,channel_code:'무신사',shipping_region_1:'경기',shipping_region_2:'성남시'}
];

test('customer insights calculate repeat behavior and privacy-safe regions',()=>{
  const result=summarizeCustomerInsights(orders);
  assert.equal(result.summary.anonymousCustomers,1);
  assert.equal(result.summary.repeatCustomerPct,100);
  assert.equal(result.summary.averagePurchaseCycleDays,10);
  assert.equal(result.regions[0].label,'서울 성동구');
  assert.equal(result.profileCoverage.demographicsAvailable,false);
});

test('return insights separate returned and cancelled quantities',()=>{
  const lines=[{order_id:'o1',product_id:'p1',quantity:2,returned_quantity:1,net_sales:100000,unit_list_price:60000,return_cost:3000},{order_id:'o3',product_id:'p1',quantity:3,returned_quantity:0,net_sales:0,unit_list_price:50000,return_cost:0}],result=summarizeReturnInsights(orders,lines,[{id:'p1',product_code:'ARC-07',product_name:'Utility Jacket'}]);
  assert.equal(result.summary.orderedQty,5);
  assert.equal(result.summary.returnedQty,1);
  assert.equal(result.summary.cancelledQty,3);
  assert.equal(result.summary.refundAmount,50000);
  assert.equal(result.summary.cancelAmount,150000);
  assert.equal(result.products[0].return_rate,20);
  assert.equal(result.products[0].cancel_rate,60);
});
