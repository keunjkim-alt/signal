export type PlanningPosition={
  skuId:string;
  locationId:string;
  availableQty:number;
  inventoryPositionQty?:number;
  safetyStockQty?:number;
  forecastP90Qty:number;
  dailyForecastQty?:number;
  minStockQty?:number;
  maxStockQty?:number|null;
  capacityQty?:number|null;
  packQty?:number;
  minTransferQty?:number;
  maxTransferQty?:number|null;
  allowRebalancing?:boolean;
  unitMargin?:number;
};

export type LogisticsRoute={
  fromLocationId:string;
  toLocationId:string;
  active?:boolean;
  minShipmentQty?:number;
  maxShipmentQty?:number|null;
  fixedCost?:number;
  variableCostPerUnit?:number;
  leadTimeDays?:number;
};

export type RebalancingRecommendation={
  recommendationKey:string;
  skuId:string;
  fromLocationId:string;
  toLocationId:string;
  recommendedQty:number;
  sourceExcessQty:number;
  destinationShortageQty:number;
  expectedLogisticsCost:number;
  expectedMarginGain:number;
  expectedNetValue:number;
  destinationCoverDays:number|null;
  reasonCodes:string[];
};

export type RebalancingOptions={routes?:LogisticsRoute[];budgetAmount?:number;minNetValue?:number;limit?:number};

const qty=(value:unknown)=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const floorToPack=(value:number,pack:number)=>Math.floor((value+1e-9)/pack)*pack;

export function optimizeRebalancing(positions:PlanningPosition[],options:RebalancingOptions={}):RebalancingRecommendation[]{
  const routeMap=new Map((options.routes||[]).filter(route=>route.active!==false).map(route=>[`${route.fromLocationId}:${route.toLocationId}`,route]));
  const requireKnownRoute=(options.routes||[]).length>0;
  let remainingBudget=Number.isFinite(options.budgetAmount)?Math.max(0,Number(options.budgetAmount)):Number.POSITIVE_INFINITY;
  const minimumNetValue=Number(options.minNetValue||0),limit=Math.max(1,Math.floor(Number(options.limit||100)));
  const working=positions.map(position=>({...position,inventoryPositionQty:qty(position.inventoryPositionQty??position.availableQty)}));
  const recommendations:RebalancingRecommendation[]=[];
  const skuIds=[...new Set(working.map(position=>position.skuId))];

  for(const skuId of skuIds){
    const group=working.filter(position=>position.skuId===skuId&&position.allowRebalancing!==false);
    const shortages=group.map(position=>{
      const target=Math.max(qty(position.forecastP90Qty),qty(position.minStockQty));
      const capacity=position.capacityQty==null?Number.POSITIVE_INFINITY:qty(position.capacityQty);
      const maxStock=position.maxStockQty==null?Number.POSITIVE_INFINITY:qty(position.maxStockQty);
      const ceiling=Math.min(capacity,maxStock);
      return {position,shortage:Math.max(0,Math.min(target,ceiling)-qty(position.inventoryPositionQty))};
    }).filter(item=>item.shortage>0).sort((a,b)=>{
      const aCover=qty(a.position.dailyForecastQty)>0?qty(a.position.inventoryPositionQty)/qty(a.position.dailyForecastQty):Number.POSITIVE_INFINITY;
      const bCover=qty(b.position.dailyForecastQty)>0?qty(b.position.inventoryPositionQty)/qty(b.position.dailyForecastQty):Number.POSITIVE_INFINITY;
      return aCover-bCover||b.shortage-a.shortage;
    });

    for(const destination of shortages){
      const sources=group.filter(position=>position.locationId!==destination.position.locationId).map(position=>{
        const sourceFloor=Math.max(qty(position.safetyStockQty),qty(position.minStockQty),qty(position.forecastP90Qty));
        return {position,surplus:Math.max(0,qty(position.inventoryPositionQty)-sourceFloor)};
      }).filter(item=>item.surplus>0).sort((a,b)=>b.surplus-a.surplus);

      for(const source of sources){
        if(destination.shortage<=0||recommendations.length>=limit)break;
        const route=routeMap.get(`${source.position.locationId}:${destination.position.locationId}`);
        if(requireKnownRoute&&!route)continue;
        const pack=Math.max(1,qty(destination.position.packQty||source.position.packQty||1));
        const maxTransfer=Math.min(
          source.position.maxTransferQty==null?Number.POSITIVE_INFINITY:qty(source.position.maxTransferQty),
          destination.position.maxTransferQty==null?Number.POSITIVE_INFINITY:qty(destination.position.maxTransferQty),
          route?.maxShipmentQty==null?Number.POSITIVE_INFINITY:qty(route.maxShipmentQty)
        );
        const fixedCost=qty(route?.fixedCost),variableCost=qty(route?.variableCostPerUnit);
        const affordableQty=Number.isFinite(remainingBudget)
          ?variableCost>0?Math.max(0,(remainingBudget-fixedCost)/variableCost):(remainingBudget>=fixedCost?Number.POSITIVE_INFINITY:0)
          :Number.POSITIVE_INFINITY;
        const raw=Math.min(destination.shortage,source.surplus,maxTransfer,affordableQty);
        const recommendedQty=floorToPack(raw,pack);
        const minimumQty=Math.max(qty(source.position.minTransferQty||1),qty(destination.position.minTransferQty||1),qty(route?.minShipmentQty||1));
        if(recommendedQty<minimumQty)continue;
        const logisticsCost=fixedCost+recommendedQty*variableCost;
        if(logisticsCost>remainingBudget)continue;
        const marginGain=recommendedQty*qty(destination.position.unitMargin);
        const netValue=marginGain-logisticsCost;
        if(netValue<minimumNetValue)continue;
        recommendations.push({
          recommendationKey:`transfer:${skuId}:${source.position.locationId}:${destination.position.locationId}`,
          skuId,fromLocationId:source.position.locationId,toLocationId:destination.position.locationId,recommendedQty,
          sourceExcessQty:source.surplus,destinationShortageQty:destination.shortage,
          expectedLogisticsCost:logisticsCost,expectedMarginGain:marginGain,expectedNetValue:netValue,
          destinationCoverDays:qty(destination.position.dailyForecastQty)>0?qty(destination.position.inventoryPositionQty)/qty(destination.position.dailyForecastQty):null,
          reasonCodes:['destination_p90_shortage','source_above_protected_stock','positive_expected_value']
        });
        remainingBudget-=logisticsCost;
        source.position.inventoryPositionQty=qty(source.position.inventoryPositionQty)-recommendedQty;
        destination.position.inventoryPositionQty=qty(destination.position.inventoryPositionQty)+recommendedQty;
        source.surplus-=recommendedQty;
        destination.shortage-=recommendedQty;
      }
    }
  }
  return recommendations.sort((a,b)=>b.expectedNetValue-a.expectedNetValue).slice(0,limit);
}
