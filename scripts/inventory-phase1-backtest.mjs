import fs from 'node:fs/promises';
import path from 'node:path';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';

const workbookPath=path.resolve(process.cwd(),'outputs/inventory-phase1-v3/VIIMsignal_Inventory_Phase1_Backtest_DataPack_v3.xlsx');
const outputDir=path.resolve(process.cwd(),'outputs/inventory-phase1-v3');
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));

const excelDate=value=>{
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='number')return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
  return String(value??'').slice(0,10);
};
const rows=name=>{
  const values=workbook.worksheets.getItem(name).getUsedRange(true).values,headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(value=>value!==null&&value!=='')).map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]])));
};
const products=rows('Product_Master'),sales=rows('Daily_Sales'),inventory=rows('Inventory_Daily'),transfers=rows('Transfer_History'),inbounds=rows('Inbound_Orders'),policies=rows('Inventory_Policies'),costPolicies=rows('Cost_Policies'),expected=rows('Backtest_Expected');
for(const row of sales)row.sales_date=excelDate(row.sales_date);
for(const row of inventory)row.snapshot_date=excelDate(row.snapshot_date);
for(const row of expected)row.as_of_date=excelDate(row.as_of_date);

const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
const std=values=>{if(values.length<2)return 0;const avg=mean(values);return Math.sqrt(values.reduce((sum,value)=>sum+(value-avg)**2,0)/(values.length-1))};
const daysBetween=(a,b)=>(new Date(`${b}T00:00:00Z`)-new Date(`${a}T00:00:00Z`))/86400000;
const round=(value,digits=1)=>{const factor=10**digits;return Math.round(value*factor)/factor};
const productBySku=new Map(products.map(row=>[String(row.sku_code),row]));
const policyByProduct=new Map(policies.map(row=>[String(row.product_code),row]));
const locations=[...new Set(inventory.map(row=>String(row.location_code)))];

const salesSeries=(sku,location,asOf,days=28)=>{
  const start=new Date(`${asOf}T00:00:00Z`);start.setUTCDate(start.getUTCDate()-days);
  const startKey=start.toISOString().slice(0,10),byDay=new Map();
  for(const row of sales)if(row.sku_code===sku&&row.location_code===location&&row.sales_date>=startKey&&row.sales_date<asOf)byDay.set(row.sales_date,(byDay.get(row.sales_date)||0)+Number(row.net_quantity||0));
  const values=[];for(let d=0;d<days;d++){const date=new Date(`${startKey}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+d);values.push(Number(byDay.get(date.toISOString().slice(0,10))||0))}return values;
};
const forecast=(sku,location,asOf)=>{
  const values=salesSeries(sku,location,asOf,28),recent=mean(values.slice(-7)),prior=mean(values.slice(0,21)),daily=.7*recent+.3*prior,sigma=std(values),lostDemandUplift=.08;
  return {daily:daily*(1+lostDemandUplift),p10:Math.max(0,(daily*7-1.28*sigma*Math.sqrt(7))),p50:daily*7,p90:daily*7+1.28*sigma*Math.sqrt(7),sigma};
};
const inventoryAt=(sku,location,asOf)=>inventory.filter(row=>row.sku_code===sku&&row.location_code===location&&row.snapshot_date<=asOf).sort((a,b)=>String(b.snapshot_date).localeCompare(String(a.snapshot_date)))[0]||null;
const routeGroup=(from,to)=>from==='DC-ONLINE'&&to.startsWith('STORE-')?'DC_TO_SEOUL':to==='STORE-BUSAN'?'SEOUL_TO_BUSAN':'SEOUL_TO_SEOUL';
const costFor=(from,to,qty)=>{const policy=costPolicies.find(row=>row.route_group===routeGroup(from,to))||costPolicies.find(row=>row.route_group==='DEFAULT');return Number(policy.base_transport_cost)+qty*(Number(policy.picking_cost_per_unit)+Number(policy.packing_cost_per_unit)+Number(policy.receiving_cost_per_unit))};
const riskLabel=cover=>cover<=3?'Critical':cover<=7?'High':cover<=14?'Medium':'Low';

function recommend(sku,asOf){
  const product=productBySku.get(sku),policy=policyByProduct.get(String(product?.product_code)),pack=Math.max(1,Number(policy?.pack_qty||1)),minQty=Number(policy?.min_transfer_qty||1),minCover=Number(policy?.min_cover_days||10),minValue=Number(policy?.min_net_value_krw||0);
  const positions=locations.map(location=>{const inv=inventoryAt(sku,location,asOf),fc=forecast(sku,location,asOf),available=Number(inv?.available_qty||0),cover=fc.daily>0?available/fc.daily:999,safety=Math.max(Number(inv?.uploaded_safety_stock_qty||0),fc.daily*minCover);return {location,available,cover,safety,forecast:fc,risk:riskLabel(cover)}});
  const to=[...positions].sort((a,b)=>a.cover-b.cover)[0],from=[...positions].filter(row=>row.location!==to.location).sort((a,b)=>(b.available-b.safety)-(a.available-a.safety))[0];
  const shortage=Math.max(0,to.forecast.p90-to.available),surplus=Math.max(0,from.available-from.safety),rawQty=Math.min(shortage,surplus),qty=Math.ceil(rawQty/pack)*pack,legacyQty=Math.floor(Math.max(0,from.available-to.available)*.35),unitMargin=Number(product?.list_price||0)-Number(product?.unit_cost||0),captured=Math.min(qty,shortage),sourceLoss=Math.max(0,qty-surplus)*unitMargin,executionCost=costFor(from.location,to.location,qty),netValue=captured*unitMargin-sourceLoss-executionCost,action=qty>=minQty&&netValue>=minValue?'transfer':'hold';
  return {sku,asOf,from:from.location,to:to.location,risk:to.risk,currentAvailable:to.available,sourceAvailable:from.available,dailyForecast:round(to.forecast.daily,2),forecast7P50:round(to.forecast.p50),forecast7P90:round(to.forecast.p90),coverDays:round(to.cover,1),legacyQty,newQty:action==='transfer'?qty:0,executionCost:round(executionCost),netExpectedValue:round(netValue),action};
}

const results=expected.map(row=>{
  const actual=recommend(String(row.sku_code),row.as_of_date),expectedQty=Number(row.expected_qty||0),expectedAction=String(row.expected_action),routeMatch=expectedAction==='hold'?actual.action==='hold':actual.from===row.from_location&&actual.to===row.to_location,actionMatch=actual.action===expectedAction,qtyError=expectedQty?Math.abs(actual.newQty-expectedQty)/expectedQty:actual.newQty===0?0:1,legacyError=expectedQty?Math.abs(actual.legacyQty-expectedQty)/expectedQty:actual.legacyQty===0?0:1;
  return {...actual,scenarioId:row.scenario_id,expectedFrom:row.from_location||null,expectedTo:row.to_location||null,expectedQty,expectedAction,actionMatch,routeMatch,quantityErrorPct:round(qtyError*100),legacyQuantityErrorPct:round(legacyError*100),pass:actionMatch&&routeMatch&&qtyError<=.5};
});
const summary={scenarios:results.length,passed:results.filter(row=>row.pass).length,passRate:round(results.filter(row=>row.pass).length/results.length*100),actionAccuracy:round(results.filter(row=>row.actionMatch).length/results.length*100),routeAccuracy:round(results.filter(row=>row.routeMatch).length/results.length*100),meanQuantityErrorPct:round(mean(results.map(row=>row.quantityErrorPct))),legacyMeanQuantityErrorPct:round(mean(results.map(row=>row.legacyQuantityErrorPct))),positiveValueRecommendations:results.filter(row=>row.action==='transfer'&&row.netExpectedValue>0).length};
const payload={generatedAt:new Date().toISOString(),workbook:workbookPath,method:{forecast:'70% recent 7-day mean + 30% prior 21-day mean; Lost Demand uplift 8%; residual P10/P50/P90',inventory:'latest as-of available inventory; 7-day P90 demand target',optimization:'destination shortage, source dynamic safety stock, pack rounding, route cost and contribution margin',baseline:'35% of max-min available inventory gap'},summary,results};
await fs.writeFile(path.join(outputDir,'inventory-phase1-backtest-result.json'),JSON.stringify(payload,null,2));
console.log(JSON.stringify(payload,null,2));
