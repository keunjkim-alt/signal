import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferSalesMapping,validateAndNormalizeSales} from '../api/_lib/sales.ts';
import {inferMapping,parseCsv,validateAndNormalize} from '../api/_lib/wms.ts';
import {summarizeCustomerInsights,summarizeReturnInsights} from '../api/_lib/customer-returns.ts';
import {buildDecisionActions} from '../api/_lib/decision-actions.ts';

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

test('closed beta sales pack drives customer, return and today-action intelligence end to end',()=>{
  const source=parseCsv(fixture('VIIMsignal_Closed_Beta_Sales_30D.csv')),normalized=validateAndNormalizeSales(source,inferSalesMapping(Object.keys(source[0]))).validRows;
  const orders=normalized.map((row,index)=>({id:row.order_id||`order-${index}`,channel_code:row.channel_code,ordered_at:row.sold_at,status:row.order_status,paid_amount:row.net_sales,customer_token:row.customer_token,shipping_region_1:row.shipping_region_1,shipping_region_2:row.shipping_region_2}));
  const lines=normalized.map((row,index)=>({order_id:row.order_id||`order-${index}`,product_id:row.sku_code,sku_id:row.sku_code,quantity:row.quantity,returned_quantity:row.returned_quantity,net_sales:row.net_sales,unit_list_price:row.quantity?row.net_sales/row.quantity:0,return_cost:row.return_cost}));
  const products=[...new Map(normalized.map(row=>[row.sku_code,{id:row.sku_code,product_code:row.sku_code,product_name:row.product_name}])).values()],customer=summarizeCustomerInsights(orders),returns=summarizeReturnInsights(orders,lines,products),actions=buildDecisionActions({customerInsight:customer,returnInsight:returns});
  assert.equal(customer.hasData,true);
  assert.ok(customer.summary.anonymousCustomers>=300);
  assert.ok(customer.regions.length>=5);
  assert.equal(returns.hasData,true);
  assert.ok(returns.summary.returnedQty>0);
  assert.ok(actions.some(row=>row.kind==='customer_opportunity'&&row.execution.action==='create_followup_task'));
  assert.ok(actions.some(row=>row.kind==='return_mitigation'&&row.execution.action==='create_followup_task'));
});
