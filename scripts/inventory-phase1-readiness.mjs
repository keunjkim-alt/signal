import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseCsv} from '../api/_lib/wms.ts';

const root=resolve(process.cwd(),'assets/templates/closed-beta/scenario-packs');
const read=name=>parseCsv(readFileSync(resolve(root,name),'utf8'));
const master=read('VIIMsignal_Product_SKU_Master_v2.csv');
const baselineSales=read('VIIMsignal_Pack1_Baseline_Sales_90D_v2.csv');
const eventSales=read('VIIMsignal_Pack2_Event_Sales_14D_v2.csv');
const baselineInventory=read('VIIMsignal_Pack1_Baseline_Inventory_v2.csv');
const eventInventory=read('VIIMsignal_Pack2_Event_Inventory_14D_v2.csv');
const production=read('VIIMsignal_Pack3_Production_Events.csv');
const workflows=read('VIIMsignal_Pack3_Workflow_Scenarios.csv');
const sales=[...baselineSales,...eventSales],inventory=[...baselineInventory,...eventInventory];

const unique=(rows,key)=>new Set(rows.map(row=>String(typeof key==='function'?key(row):row[key]??''))).size;
const duplicates=(rows,keyFn)=>rows.length-new Set(rows.map(keyFn)).size;
const missing=(rows,key)=>rows.filter(row=>String(row[key]??'').trim()==='').length;
const dates=(rows,key)=>rows.map(row=>new Date(row[key])).filter(date=>!Number.isNaN(date.getTime())).sort((a,b)=>a-b);
const daySpan=(rows,key)=>{const values=dates(rows,key);return values.length?Math.round((values.at(-1)-values[0])/86400000)+1:0};
const pct=(value,total)=>total?Math.round(value/total*10000)/100:0;
const salesSkus=new Set(sales.map(row=>row.sku_code)),inventorySkus=new Set(inventory.map(row=>row.sku_code)),masterSkus=new Set(master.map(row=>row.sku_code));
const salesLocations=new Set(sales.map(row=>row.location_code)),inventoryLocations=new Set(inventory.map(row=>row.location_code));
const inventoryDays=unique(eventInventory,row=>row.snapshot_at?.slice(0,10));
const expectedInventoryRows=unique(eventInventory,'sku_code')*unique(eventInventory,'location_code')*inventoryDays;
const negativeAvailable=inventory.filter(row=>Number(row.available_qty)<0).length;
const inventoryEquationMismatch=inventory.filter(row=>Math.abs(Number(row.on_hand_qty)-Number(row.reserved_qty)-Number(row.available_qty))>.001).length;
const salesDuplicate=duplicates(sales,row=>`${row.order_id}:${row.line_id}`);
const inventoryDuplicate=duplicates(inventory,row=>`${row.sku_code}:${row.location_code}:${row.snapshot_at}`);
const cancelledWithSales=sales.filter(row=>row.order_status==='cancelled'&&Number(row.net_sales)!==0).length;
const masterMissing=[...new Set([...salesSkus,...inventorySkus])].filter(code=>!masterSkus.has(code));
const locationOnlyInInventory=[...inventoryLocations].filter(code=>!salesLocations.has(code));

const checks=[
  {id:'master_sku_mapping',area:'상품·SKU',weight:15,status:masterMissing.length?'FAIL':'PASS',detail:`미매핑 ${masterMissing.length}개 / 운영 SKU ${new Set([...salesSkus,...inventorySkus]).size}개`},
  {id:'fashion_attributes',area:'상품·SKU',weight:5,status:master.some(row=>!row.color||!row.size||!row.category_l1)?'FAIL':'PASS',detail:'컬러·사이즈·카테고리'},
  {id:'sales_history',area:'판매',weight:15,status:daySpan(sales,'sold_at')>=90?'PASS':'FAIL',detail:`${daySpan(sales,'sold_at')}일 · ${sales.length.toLocaleString()}행`},
  {id:'sales_uniqueness',area:'판매',weight:5,status:salesDuplicate?'FAIL':'PASS',detail:`주문라인 중복 ${salesDuplicate}건`},
  {id:'sales_integrity',area:'판매',weight:5,status:cancelledWithSales?'FAIL':'PASS',detail:`취소 주문 순매출 모순 ${cancelledWithSales}건`},
  {id:'inventory_history',area:'재고',weight:15,status:inventoryDays>=30?'PASS':inventoryDays>=14?'WARN':'FAIL',detail:`연속 이벤트 스냅샷 ${inventoryDays}일`},
  {id:'inventory_completeness',area:'재고',weight:5,status:eventInventory.length===expectedInventoryRows?'PASS':'WARN',detail:`기대 ${expectedInventoryRows.toLocaleString()}행 / 실제 ${eventInventory.length.toLocaleString()}행`},
  {id:'inventory_uniqueness',area:'재고',weight:5,status:inventoryDuplicate?'FAIL':'PASS',detail:`SKU×위치×시점 중복 ${inventoryDuplicate}건`},
  {id:'inventory_equation',area:'재고',weight:5,status:pct(inventoryEquationMismatch,inventory.length)<=.5?'PASS':'FAIL',detail:`산식 불일치 ${inventoryEquationMismatch}건 (${pct(inventoryEquationMismatch,inventory.length)}%)`},
  {id:'negative_inventory',area:'재고',weight:5,status:pct(negativeAvailable,inventory.length)<=.1?'PASS':'FAIL',detail:`음수 가용재고 ${negativeAvailable}건 (${pct(negativeAvailable,inventory.length)}%)`},
  {id:'inbound_lead_time',area:'입고·발주',weight:5,status:production.every(row=>row.production_order_no&&row.due_date&&row.event_at)?'WARN':'FAIL',detail:'공정 이벤트는 있으나 발주일·약속일·실제입고일·SKU 라인 부족'},
  {id:'movement_cost',area:'이동·비용',weight:5,status:'FAIL',detail:'실제 이동 출고·입고·운송비 데이터 없음'},
  {id:'inventory_policy',area:'정책',weight:5,status:'WARN',detail:'안전재고 값은 있으나 목표 서비스 수준·핵심 사이즈·박스단위 정책 없음'}
];

const earned=checks.reduce((total,check)=>total+(check.status==='PASS'?check.weight:check.status==='WARN'?check.weight*.5:0),0);
const failCount=checks.filter(check=>check.status==='FAIL').length;
const criticalFails=checks.filter(check=>['master_sku_mapping','sales_history','sales_uniqueness','inventory_uniqueness','inventory_equation','negative_inventory'].includes(check.id)&&check.status==='FAIL');
const grade=criticalFails.length||earned<70?'Not Ready':earned<85||failCount?'Conditionally Ready':'Ready';

console.log(JSON.stringify({
  generatedAt:new Date().toISOString(),dataset:'closed-beta scenario packs v2',grade,score:earned,maxScore:100,failCount,criticalFailCount:criticalFails.length,
  coverage:{masterRows:master.length,skus:masterSkus.size,styles:unique(master,'product_code'),salesRows:sales.length,salesDays:daySpan(sales,'sold_at'),salesChannels:unique(sales,'channel_code'),salesLocations:salesLocations.size,inventoryRows:inventory.length,eventInventoryDays:inventoryDays,inventoryLocations:inventoryLocations.size,productionEvents:production.length,workflowScenarios:workflows.length},
  caveats:{masterMissing,locationOnlyInInventory,externalDataAvailable:false,actualMovementHistoryAvailable:false,purchaseOrderLineHistoryAvailable:false,stockoutEventsAvailable:false},
  checks
},null,2));
