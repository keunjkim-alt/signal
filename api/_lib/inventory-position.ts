export type InventoryPositionInput={
  onHandQty?:number;
  reservedQty?:number;
  availableQty?:number|null;
  inboundConfirmedQty?:number;
  transferInQty?:number;
  transferOutQty?:number;
  damagedQty?:number;
  safetyStockQty?:number;
};

const quantity=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;

export function calculateInventoryPosition(input:InventoryPositionInput={}){
  const onHandQty=quantity(input.onHandQty),reservedQty=quantity(input.reservedQty),damagedQty=quantity(input.damagedQty);
  const availableQty=input.availableQty===null||input.availableQty===undefined
    ?Math.max(0,onHandQty-reservedQty-damagedQty)
    :quantity(input.availableQty);
  const inboundConfirmedQty=quantity(input.inboundConfirmedQty),transferInQty=quantity(input.transferInQty),transferOutQty=quantity(input.transferOutQty);
  const inventoryPositionQty=Math.max(0,availableQty+inboundConfirmedQty+transferInQty-transferOutQty);
  const safetyStockQty=quantity(input.safetyStockQty);
  return {onHandQty,reservedQty,availableQty,inboundConfirmedQty,transferInQty,transferOutQty,damagedQty,safetyStockQty,inventoryPositionQty,stockoutFlag:availableQty<=0};
}

