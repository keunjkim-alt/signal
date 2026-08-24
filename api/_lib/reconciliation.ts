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
