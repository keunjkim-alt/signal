import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inferSalesMapping,validateAndNormalizeSales} from '../api/_lib/sales.ts';
import {buildDecisionActions} from '../api/_lib/decision-actions.ts';
import {buildTransferCandidates,summarizeInventorySnapshot} from '../api/_lib/inventory-operations.ts';
import {inferMapping,parseCsv,validateAndNormalize} from '../api/_lib/wms.ts';
import {buildReorderPayload,planningReorderQuantity,productionOrdersFromRecommendations} from '../api/dashboards/query.ts';

const fixture=(name:string)=>readFileSync(new URL(`../assets/templates/closed-beta/${name}`,import.meta.url),'utf8');

test('sample upload becomes an inventory signal, approval payload and production queue order',()=>{
  const salesSource=parseCsv(fixture('VIIMsignal_Closed_Beta_Sales_30D.csv'));
  const sales=validateAndNormalizeSales(salesSource,inferSalesMapping(Object.keys(salesSource[0]))).validRows;
  const inventorySource=parseCsv(fixture('VIIMsignal_Closed_Beta_Inventory.csv'));
  const inventory=validateAndNormalize(inventorySource,inferMapping(Object.keys(inventorySource[0]))).validRows;
  const productCodes=[...new Set(sales.map(row=>row.sku_code))];
  const locationCodes=[...new Set(inventory.map(row=>row.location_code))];
  const products=productCodes.map(code=>({id:`product:${code}`,product_code:code,product_name:sales.find(row=>row.sku_code===code)?.product_name||code}));
  const skus=productCodes.map(code=>({id:`sku:${code}`,sku_code:code,product_id:`product:${code}`}));
  const locations=locationCodes.map(code=>({id:`location:${code}`,location_code:code,location_name:inventory.find(row=>row.location_code===code)?.location_name||code,country_code:code.includes('SHANGHAI')?'CN':'KR'}));
  const locationMap=new Map(locations.map(row=>[row.location_code,row.id])),skuMap=new Map(skus.map(row=>[row.sku_code,row.id]));
  const snapshots=inventory.map(row=>({...row,sku_id:skuMap.get(row.sku_code),location_id:locationMap.get(row.location_code)}));
  const orders=sales.map((row,index)=>({id:`order:${index}`,location_id:locationMap.get(row.location_code),channel_code:row.channel_code,country_code:row.country_code}));
  const lines=sales.map((row,index)=>({order_id:`order:${index}`,sku_id:skuMap.get(row.sku_code),quantity:row.quantity}));
  const inventorySummary=summarizeInventorySnapshot({snapshots,skus,products,locations,orders,lines,periodDays:30});
  assert.equal(inventorySummary.products.length,productCodes.length);
  const transfer=buildTransferCandidates(snapshots)[0];
  assert.ok(transfer?.recommended_qty>0,'inventory imbalance should generate a transfer signal');
  const targetCode='ARC-07-BLK-F',sold=sales.filter(row=>row.sku_code===targetCode).reduce((sum,row)=>sum+row.quantity,0),available=inventory.filter(row=>row.sku_code===targetCode).reduce((sum,row)=>sum+row.available_qty,0);
  const forecast={product_code:targetCode,product_name:'Utility Jacket',horizon_days:30,forecast_quantity:sold,available_qty:available,safety_stock_qty:35,forecast_net_sales:165000000,confidence:.88};
  const reorderQty=planningReorderQuantity(forecast,14);
  assert.ok(reorderQty>0,'sales velocity and stock should generate a reorder signal');
  const locationById=new Map(locations.map(row=>[row.id,row])),skuById=new Map(skus.map(row=>[row.id,row]));
  const actions=buildDecisionActions({
    transfers:[{...transfer,sku:{product_code:skuById.get(transfer.sku_id)?.sku_code},from_location:locationById.get(transfer.from_location_id),to_location:locationById.get(transfer.to_location_id)}],
    reorders:[{...forecast,status:'proposed',recommended_reorder_qty:reorderQty}]
  });
  assert.ok(actions.some(row=>row.kind==='transfer'&&row.execution.action==='approve_transfer'));
  const reorderAction=actions.find(row=>row.kind==='reorder');
  assert.equal(reorderAction?.execution.action,'approve_reorder');
  const payload=buildReorderPayload({...reorderAction!.execution,now:'2026-09-03T00:00:00Z'});
  const recommendation={id:'recommendation-1',conversation_id:'conversation-1',recommendation_key:`reorder:${targetCode}`,page_key:'inventory',title:reorderAction!.title,status:'approved',payload,approved_at:'2026-09-03T00:00:00Z',updated_at:'2026-09-03T00:00:00Z'};
  const [productionOrder]=productionOrdersFromRecommendations([recommendation],products);
  assert.equal(productionOrder.product_code,targetCode);
  assert.equal(productionOrder.quantity,reorderQty);
  assert.equal(productionOrder.production_status,'approved');
  assert.match(productionOrder.production_order_no,/^PO-260903-/);
});
