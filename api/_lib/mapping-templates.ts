const ENTITY_FIELDS:Record<string,string[]>={
  sales_order:['sold_at','channel_code','sku_code','quantity','net_sales','unit_cost','channel_fee','marketing_cost','shipping_cost','return_cost','location_code','location_name','product_name','category','order_id','line_id','country_code','currency_code','source_updated_at'],
  inventory_snapshot:['sku_code','location_code','location_name','snapshot_at','on_hand_qty','reserved_qty','available_qty','in_transit_qty','damaged_qty','safety_stock_qty']
};

const REQUIRED_FIELDS:Record<string,string[]>={
  sales_order:['sold_at','channel_code','sku_code','quantity','net_sales'],
  inventory_snapshot:['sku_code','location_code','snapshot_at','available_qty']
};

const normalizeHeader=(value:any)=>String(value??'').trim().toLowerCase().replace(/[\s._\-/()]+/g,'');

export function mappingFields(entityType:string){return ENTITY_FIELDS[entityType]||[]}
export function requiredMappingFields(entityType:string){return REQUIRED_FIELDS[entityType]||[]}

export function sanitizeMapping(entityType:string,headers:string[],input:any={}){
  const allowed=new Set(mappingFields(entityType)),headerSet=new Set(headers),mapping:Record<string,string>={};
  if(!input||typeof input!=='object'||Array.isArray(input))return mapping;
  for(const [field,source] of Object.entries(input)){
    const sourceName=String(source??'').trim();
    if(allowed.has(field)&&headerSet.has(sourceName))mapping[field]=sourceName;
  }
  return mapping;
}

export async function headerSignature(headers:string[]){
  const canonical=[...new Set(headers.map(normalizeHeader).filter(Boolean))].sort().join('|'),bytes=new TextEncoder().encode(canonical),hash=await crypto.subtle.digest('SHA-256',bytes);
  return `sha256:${[...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')}`;
}

export function chooseMapping(entityType:string,headers:string[],requested:any,saved:any,inferred:any){
  const requestedMapping=sanitizeMapping(entityType,headers,requested),savedMapping=sanitizeMapping(entityType,headers,saved),inferredMapping=sanitizeMapping(entityType,headers,inferred);
  if(Object.keys(requestedMapping).length)return {mapping:{...inferredMapping,...requestedMapping},source:'request'};
  if(Object.keys(savedMapping).length)return {mapping:{...inferredMapping,...savedMapping},source:'saved_template'};
  return {mapping:inferredMapping,source:'auto'};
}

type DetectionCandidate={
  mapping:Record<string,string>;
  validRows?:number;
  errorRows?:number;
  missingFields?:string[];
};

export function detectEntityType(candidates:Record<string,DetectionCandidate>){
  const scored=Object.entries(candidates).map(([entityType,candidate])=>{
    const required=requiredMappingFields(entityType),fields=mappingFields(entityType),mapping=candidate.mapping||{},missing=candidate.missingFields||required.filter(field=>!mapping[field]);
    const requiredCoverage=required.length?(required.length-missing.length)/required.length:0,mappedCoverage=fields.length?Math.min(1,Object.keys(mapping).length/Math.min(fields.length,10)):0,totalRows=Number(candidate.validRows||0)+Number(candidate.errorRows||0),rowQuality=totalRows?Number(candidate.validRows||0)/totalRows:0;
    const score=Math.max(0,Math.min(100,Math.round(requiredCoverage*70+mappedCoverage*10+rowQuality*20)));
    return {entityType,score,requiredCoverage:Number(requiredCoverage.toFixed(2)),rowQuality:Number(rowQuality.toFixed(2)),mappedFields:Object.keys(mapping).length,missingFields:missing};
  }).sort((a,b)=>b.score-a.score);
  const winner=scored[0]||{entityType:'sales_order',score:0,requiredCoverage:0,rowQuality:0,mappedFields:0,missingFields:[]},runnerUp=scored[1],gap=winner.score-Number(runnerUp?.score||0),confidence=winner.score>=85&&winner.requiredCoverage===1&&gap>=20?'high':winner.score>=65&&winner.requiredCoverage>=.75&&gap>=10?'medium':'low';
  return {recommended: winner.entityType,confidence,score:winner.score,gap,candidates:Object.fromEntries(scored.map(item=>[item.entityType,item])),requiresConfirmation:true};
}
