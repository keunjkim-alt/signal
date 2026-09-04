export type DemandForecastInput={
  history:number[];
  horizonDays?:number;
  recentDays?:number;
  lostDemandUpliftRate?:number;
  zScore?:number;
};

export type DemandForecast={
  dailyMean:number;
  p10Qty:number;
  p50Qty:number;
  p90Qty:number;
  sigma:number;
  lostDemandUpliftQty:number;
  horizonDays:number;
  method:string;
};

const finite=(value:unknown,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const sampleStd=(values:number[])=>{
  if(values.length<2)return 0;
  const average=mean(values);
  return Math.sqrt(values.reduce((sum,value)=>sum+(value-average)**2,0)/(values.length-1));
};

export function forecastDemand(input:DemandForecastInput):DemandForecast{
  const history=(input.history||[]).map(value=>Math.max(0,finite(value)));
  const horizonDays=Math.max(1,Math.floor(finite(input.horizonDays,7)));
  const recentDays=Math.max(1,Math.min(history.length||1,Math.floor(finite(input.recentDays,7))));
  const upliftRate=Math.max(0,finite(input.lostDemandUpliftRate,.08));
  const zScore=Math.max(0,finite(input.zScore,1.28));
  const recent=history.slice(-recentDays),prior=history.slice(0,-recentDays);
  const recentMean=mean(recent),priorMean=prior.length?mean(prior):recentMean;
  const observedDaily=.7*recentMean+.3*priorMean;
  const dailyMean=observedDaily*(1+upliftRate);
  const sigma=sampleStd(history),uncertainty=zScore*sigma*Math.sqrt(horizonDays);
  const p50Qty=dailyMean*horizonDays;
  return {
    dailyMean,
    p10Qty:Math.max(0,p50Qty-uncertainty),
    p50Qty,
    p90Qty:p50Qty+uncertainty,
    sigma,
    lostDemandUpliftQty:observedDaily*upliftRate*horizonDays,
    horizonDays,
    method:'weighted_recent_mean_with_lost_demand_uplift'
  };
}

