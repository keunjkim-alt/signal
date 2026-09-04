export type RecommendationOutcomeInput={
  recommendedQty:number;
  executedQty:number;
  expectedNetValue?:number;
  realizedRevenueGain?:number;
  realizedMarginGain?:number;
  realizedLogisticsCost?:number;
  forecastQty?:number;
  realizedSalesQty?:number;
};

const finite=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const percentageError=(actual:number,expected:number)=>expected>0?Math.abs(actual-expected)/expected*100:actual===0?0:null;

export function measureRecommendationOutcome(input:RecommendationOutcomeInput){
  const recommendedQty=Math.max(0,finite(input.recommendedQty)),executedQty=Math.max(0,finite(input.executedQty));
  const realizedRevenueGain=finite(input.realizedRevenueGain),realizedMarginGain=finite(input.realizedMarginGain),realizedLogisticsCost=Math.max(0,finite(input.realizedLogisticsCost));
  const realizedNetValue=realizedMarginGain-realizedLogisticsCost;
  return {
    recommendedQty,executedQty,realizedRevenueGain,realizedMarginGain,realizedLogisticsCost,realizedNetValue,
    quantityErrorPct:percentageError(executedQty,recommendedQty),
    forecastErrorPct:percentageError(Math.max(0,finite(input.realizedSalesQty)),Math.max(0,finite(input.forecastQty))),
    netValueVariance:realizedNetValue-finite(input.expectedNetValue)
  };
}

