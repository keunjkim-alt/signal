const number=(value:any)=>Number.isFinite(Number(value))?Number(value):0;
const round=(value:number,places=2)=>Number(value.toFixed(places));
const distinct=(rows:any[],fields:string[])=>new Set(rows.map(row=>fields.map(field=>row?.[field]).find(value=>value!==null&&value!==undefined&&value!=='')).filter(Boolean).map(String)).size;

export function salesControlTotals(rows:any[]){
  return {
    rows:rows.length,
    orders:distinct(rows,['source_order_id','order_id']),
    skus:distinct(rows,['sku_code','sku_id']),
    quantity:round(rows.reduce((sum,row)=>sum+number(row.quantity),0),3),
    returnedQuantity:round(rows.reduce((sum,row)=>sum+number(row.returned_quantity),0),3),
    netSales:round(rows.reduce((sum,row)=>sum+number(row.net_sales),0),2)
  };
}

export function inventoryControlTotals(rows:any[]){
  return {
    rows:rows.length,
    skus:distinct(rows,['sku_code','sku_id']),
    locations:distinct(rows,['location_code','location_id']),
    onHandQty:round(rows.reduce((sum,row)=>sum+number(row.on_hand_qty),0),3),
    reservedQty:round(rows.reduce((sum,row)=>sum+number(row.reserved_qty),0),3),
    availableQty:round(rows.reduce((sum,row)=>sum+number(row.available_qty),0),3)
  };
}

const definitions:any={
  sales_order:[['rows','정상 행','행'],['orders','주문','건'],['skus','SKU','개'],['quantity','판매수량','개'],['returnedQuantity','반품수량','개'],['netSales','순매출','원']],
  inventory_snapshot:[['rows','정상 행','행'],['skus','SKU','개'],['locations','매장·창고','곳'],['onHandQty','보유재고','개'],['reservedQty','예약재고','개'],['availableQty','가용재고','개']]
};

export function buildReconciliation(entityType:string,source:any,persisted:any,options:any={}){
  const checks=(definitions[entityType]||[]).map(([key,label,unit]:string[])=>{
    const sourceValue=number(source?.[key]),persistedValue=number(persisted?.[key]),tolerance=key==='netSales'?.01:.001,match=Math.abs(sourceValue-persistedValue)<=tolerance;
    return {key,label,unit,source:sourceValue,persisted:persistedValue,difference:round(persistedValue-sourceValue,key==='netSales'?2:3),match};
  });
  const available=Boolean(source&&persisted),matched=available&&checks.every((check:any)=>check.match),status=!available?'unavailable':matched?'matched':'mismatch';
  return {entityType,status,matched,checkedAt:options.checkedAt||new Date().toISOString(),filename:options.filename||null,jobId:options.jobId||null,source,persisted,checks};
}

export function shouldBlockAnalytics(reconciliation:any){return reconciliation?.status==='mismatch'}

export function summarizeDataQuality(items:any[]){
  const mismatches=items.filter(item=>item.reconciliation?.status==='mismatch'),unavailable=items.filter(item=>!item.reconciliation||item.reconciliation.status==='unavailable'),status=mismatches.length?'blocked':unavailable.length?'checking':'healthy';
  return {status,blocked:status==='blocked',mismatches,unavailable};
}

export async function analyticsRefreshGate(organizationId:string){
  const query=new URLSearchParams({organization_id:`eq.${organizationId}`,status:'in.(completed,partial)',entity_type:'in.(sales_order,inventory_snapshot)',select:'id,entity_type,status,summary,completed_at,created_at',order:'created_at.desc',limit:'40'}),jobs=(await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[],items=['sales_order','inventory_snapshot'].map(type=>jobs.find((job:any)=>job.entity_type===type)).filter(Boolean).map((job:any)=>({jobId:job.id,entityType:job.entity_type,reconciliation:job.summary?.reconciliation||null,completedAt:job.completed_at||job.created_at}));
  return {...summarizeDataQuality(items),items};
}

export async function assertAnalyticsRefreshAllowed(organizationId:string){
  const quality=await analyticsRefreshGate(organizationId);if(!quality.blocked)return quality;
  const mismatch=quality.mismatches[0],checks=(mismatch?.reconciliation?.checks||[]).filter((check:any)=>!check.match).map((check:any)=>check.label).join(', '),error:any=new Error(`데이터 정합성 불일치로 분석 갱신이 차단되었습니다${checks?`: ${checks}`:''}. 데이터 연결에서 원천과 DB를 다시 확인해주세요.`);error.status=409;error.code='DATA_QUALITY_BLOCKED';throw error;
}

export async function persistedControlTotals(organizationId:string,job:{id:string;raw_upload_id?:string|null;entity_type:string}){
  if(job.entity_type==='sales_order')return salesControlTotals(await fetchPaged('sales_order_lines',{organization_id:`eq.${organizationId}`,import_job_id:`eq.${job.id}`},'order_id,sku_id,quantity,returned_quantity,net_sales'));
  if(job.entity_type==='inventory_snapshot')return inventoryControlTotals(await fetchPaged('inventory_snapshots',{organization_id:`eq.${organizationId}`,raw_upload_id:`eq.${job.raw_upload_id}`},'sku_id,location_id,on_hand_qty,reserved_qty,available_qty'));
  throw new Error(`지원하지 않는 정합성 유형입니다: ${job.entity_type}`);
}

async function fetchPaged(table:string,filters:Record<string,string>,select:string){
  const rows:any[]=[],pageSize=1000;
  for(let offset=0;;offset+=pageSize){const query=new URLSearchParams({...filters,select}),page=(await supabase(`/rest/v1/${table}?${query}`,{serviceRole:true,headers:{Range:`${offset}-${offset+pageSize-1}`,'Range-Unit':'items'}})).data||[];rows.push(...page);if(page.length<pageSize)break}
  return rows;
}
import {supabase} from './supabase.js';
