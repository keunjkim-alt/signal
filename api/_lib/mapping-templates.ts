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
