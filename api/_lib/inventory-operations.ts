export function latestInventoryRows(rows:any[]=[]){
  const seen=new Set<string>();
  return rows.filter(row=>{
    const key=`${row.sku_id}:${row.location_id}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

export function buildTransferCandidates(rows:any[]=[],existing:any[]=[],limit=8){
  const blocked=new Set(existing.filter(row=>!['cancelled','received'].includes(String(row.status||''))).map(row=>`${row.sku_id}:${row.from_location_id}:${row.to_location_id}`));
  const bySku=new Map<string,any[]>();
  for(const row of latestInventoryRows(rows)){
    if(!bySku.has(row.sku_id))bySku.set(row.sku_id,[]);
    bySku.get(row.sku_id)!.push(row);
  }
  const candidates:any[]=[];
  for(const [skuId,locations] of bySku){
    if(locations.length<2)continue;
    const sorted=[...locations].sort((a,b)=>Number(b.available_qty||0)-Number(a.available_qty||0));
    const from=sorted[0],to=sorted.at(-1)!;
    const surplus=Math.max(0,Number(from.available_qty||0)-Number(from.safety_stock_qty||0));
    const gap=Math.max(0,Number(from.available_qty||0)-Number(to.available_qty||0));
    const recommendedQty=Math.floor(Math.min(surplus,gap*.35));
    const key=`${skuId}:${from.location_id}:${to.location_id}`;
    if(recommendedQty<10||blocked.has(key))continue;
    candidates.push({proposal_key:key,sku_id:skuId,from_location_id:from.location_id,to_location_id:to.location_id,recommended_qty:recommendedQty,status:'recommended',reason:{source:'inventory_imbalance',from_available:Number(from.available_qty||0),to_available:Number(to.available_qty||0),safety_stock:Number(from.safety_stock_qty||0),snapshot_at:from.snapshot_at}});
  }
  return candidates.sort((a,b)=>Number(b.recommended_qty)-Number(a.recommended_qty)).slice(0,limit);
}

export function nextMovementStatus(status:string){
  if(status==='approved'||status==='pending')return 'in_transit';
  if(status==='in_transit'||status==='delayed')return 'received';
  return null;
}
