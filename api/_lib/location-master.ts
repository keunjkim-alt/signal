export function inventoryLocationsFromRows(rows:any[]){
  const seen=new Set<string>(),locations:any[]=[];
  for(const row of rows){
    const code=String(row?.location_code||'').trim().toUpperCase();
    if(!code||seen.has(code))continue;
    seen.add(code);
    const countryCode=code.includes('SHANGHAI')||code.startsWith('CN-')?'CN':'KR';
    locations.push({location_code:code,location_name:String(row?.location_name||code).trim()||code,location_type:/^(DC|WH|WAREHOUSE)[-_]/.test(code)?'warehouse':'store',country_code:countryCode,timezone:countryCode==='CN'?'Asia/Shanghai':'Asia/Seoul',active:true});
  }
  return locations;
}
