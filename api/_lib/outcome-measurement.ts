export type OutcomeSale={date:string;quantity:number;netSales:number;unitCostAmount:number};
export type OutcomeMeasurementInput={
  measurementStartDate:string;
  measurementEndDate:string;
  dataWatermarkDate:string;
  dataStartDate:string;
  sales:OutcomeSale[];
  executedQty:number;
  recommendedQty:number;
  expectedNetValue:number;
  expectedLogisticsCost:number;
};

const ms=86400000;
const date=value=>String(value||'').slice(0,10);
const daysBetween=(start:string,end:string)=>Math.max(0,Math.round((new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/ms));
const shift=(value:string,days:number)=>{const result=new Date(`${value}T00:00:00Z`);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10)};
const sum=(rows:OutcomeSale[],key:keyof OutcomeSale)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const pctError=(actual:number,expected:number)=>expected>0?Math.abs(actual-expected)/expected*100:actual===0?0:null;

export function measureInternalOutcome(input:OutcomeMeasurementInput){
  const start=date(input.measurementStartDate),end=date(input.measurementEndDate),windowDays=daysBetween(start,end),requiredWatermark=shift(end,-1);
  if(!start||!end||windowDays<=0)return {ready:false,reason:'invalid_measurement_window'};
  if(date(input.dataWatermarkDate)<requiredWatermark)return {ready:false,reason:'sales_data_not_complete',requiredWatermark};
  const actual=input.sales.filter(row=>date(row.date)>=start&&date(row.date)<end),baselineStart=shift(start,-28),baseline=input.sales.filter(row=>date(row.date)>=baselineStart&&date(row.date)<start);
  if(!input.dataStartDate||date(input.dataStartDate)>baselineStart)return {ready:false,reason:'insufficient_baseline',baselineStart,dataStartDate:date(input.dataStartDate)};
  const actualQty=sum(actual,'quantity'),baselineQty=sum(baseline,'quantity')/28*windowDays,incrementalQty=actualQty-baselineQty,actualRevenue=sum(actual,'netSales'),actualMargin=actualRevenue-sum(actual,'unitCostAmount'),baselineRevenue=sum(baseline,'netSales')/28*windowDays,baselineMargin=(sum(baseline,'netSales')-sum(baseline,'unitCostAmount'))/28*windowDays;
  const executedQty=Math.max(0,Number(input.executedQty||0)),recommendedQty=Math.max(0,Number(input.recommendedQty||0)),logisticsCost=Number(input.expectedLogisticsCost||0)*(recommendedQty?executedQty/recommendedQty:0),realizedRevenueGain=actualRevenue-baselineRevenue,realizedMarginGain=actualMargin-baselineMargin,realizedNetValue=realizedMarginGain-logisticsCost;
  return {ready:true,windowDays,actualQty,baselineQty,incrementalQty,realizedRevenueGain,realizedMarginGain,realizedLogisticsCost:logisticsCost,realizedNetValue,quantityErrorPct:pctError(executedQty,recommendedQty),baselineDeviationPct:pctError(actualQty,baselineQty),netValueVariance:realizedNetValue-Number(input.expectedNetValue||0),baselineStart,requiredWatermark};
}
