export function latestInventoryRows(rows:any[]=[]){
  const seen=new Set<string>();
  return rows.filter(row=>{
    const key=`${row.sku_id}:${row.location_id}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

const round=(value:number,digits=1)=>{const factor=10**digits;return Math.round(value*factor)/factor};

export function summarizeInventorySnapshot(input:any={}){
  const rows=latestInventoryRows([...(input.snapshots||[])].sort((a,b)=>String(b.snapshot_at||'').localeCompare(String(a.snapshot_at||''))));
  const skuMap=new Map((input.skus||[]).map((row:any)=>[String(row.id),row]));
  const productMap=new Map((input.products||[]).map((row:any)=>[String(row.id),row]));
  const locationMap=new Map((input.locations||[]).map((row:any)=>[String(row.id),row]));
  const allowedCountries=input.allowedCountries?new Set(input.allowedCountries.map(String)):null;
  const allowedLocations=input.allowedLocations?new Set(input.allowedLocations.map(String)):null;
  const allowedChannels=input.allowedChannels?new Set(input.allowedChannels.map(String)):null;
  const days=Math.max(1,Number(input.periodDays||14));
  const orders=(input.orders||[]).filter((row:any)=>{
    const location:any=locationMap.get(String(row.location_id))||{};
    return (!allowedCountries||allowedCountries.has(String(row.country_code||location.country_code||'')))
      &&(!allowedLocations||allowedLocations.has(String(location.location_code||'')))
      &&(!allowedChannels||allowedChannels.has(String(row.channel_code||'')));
  });
  const orderMap=new Map(orders.map((row:any)=>[String(row.id),row]));
  const soldBySku=new Map<string,number>(),soldByLocation=new Map<string,number>();
  for(const line of input.lines||[]){
    const order:any=orderMap.get(String(line.order_id));
    if(!order)continue;
    const quantity=Number(line.quantity||0),skuId=String(line.sku_id||''),locationId=String(order.location_id||'');
    soldBySku.set(skuId,(soldBySku.get(skuId)||0)+quantity);
    if(locationId)soldByLocation.set(locationId,(soldByLocation.get(locationId)||0)+quantity);
  }
  const scopedRows=rows.filter((row:any)=>{
    const location:any=locationMap.get(String(row.location_id))||{};
    return (!allowedCountries||allowedCountries.has(String(location.country_code||'')))
      &&(!allowedLocations||allowedLocations.has(String(location.location_code||'')));
  });
  const productGroups=new Map<string,any>(),locationGroups=new Map<string,any>(),countedProductSkus=new Set<string>();
  for(const row of scopedRows){
    const sku:any=skuMap.get(String(row.sku_id))||{},product:any=productMap.get(String(sku.product_id))||{},location:any=locationMap.get(String(row.location_id))||{};
    const productKey=String(product.id||sku.product_id||row.sku_id),locationKey=String(location.id||row.location_id),available=Number(row.available_qty||0);
    if(!productGroups.has(productKey))productGroups.set(productKey,{label:product.product_name||product.product_code||sku.sku_code||'상품',product_code:product.product_code||sku.sku_code||null,image_url:product.image_url||null,available_qty:0,sold:0});
    const productGroup=productGroups.get(productKey);productGroup.available_qty+=available;const productSkuKey=`${productKey}:${row.sku_id}`;if(!countedProductSkus.has(productSkuKey)){productGroup.sold+=Number(soldBySku.get(String(row.sku_id))||0);countedProductSkus.add(productSkuKey)}
    if(!locationGroups.has(locationKey))locationGroups.set(locationKey,{label:location.location_name||location.location_code||'위치 미확인',location_code:location.location_code||null,country_code:location.country_code||null,available_qty:0,sold:Number(soldByLocation.get(String(row.location_id))||0)});
    locationGroups.get(locationKey).available_qty+=available;
  }
  const finish=(group:any)=>{const daily=group.sold/days,total=group.sold+group.available_qty;return {...group,inventory_cover_days:daily>0?round(group.available_qty/daily):null,sell_through_rate:total>0?round(group.sold/total*100):null}};
  return {
    products:[...productGroups.values()].map(finish).sort((a,b)=>b.available_qty-a.available_qty),
    locations:[...locationGroups.values()].map(finish).sort((a,b)=>b.available_qty-a.available_qty),
    latestSnapshotAt:scopedRows[0]?.snapshot_at||null
  };
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
