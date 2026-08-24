import {supabase} from './supabase.js';
import {assertAnalyticsRefreshAllowed} from './reconciliation.js';

export const POST_IMPORT_PIPELINES=[
  {key:'sales_forecast',label:'수요예측·재주문',rpc:'refresh_sales_forecasts',horizonDays:28},
  {key:'discount_optimization',label:'최적 할인 추천',rpc:'refresh_discount_recommendations',horizonDays:14}
] as const;

export function analysisDate(periodEnd?:string|null,now=new Date()){
  const parsed=periodEnd?new Date(periodEnd):null;
  return parsed&&!Number.isNaN(parsed.getTime())?parsed.toISOString().slice(0,10):now.toISOString().slice(0,10);
}

export function summarizePipelineResults(results:Array<{key:string;label:string;status:'completed'|'failed';result?:any;error?:string}>,refreshedAt=new Date().toISOString()){
  const completed=results.filter(item=>item.status==='completed').length,failed=results.length-completed;
  return {status:failed===0?'completed':completed?'partial':'failed',completed,failed,total:results.length,refreshedAt,results};
}

export async function refreshPostImportAnalytics(organizationId:string,options:{periodEnd?:string|null}={}){
  await assertAnalyticsRefreshAllowed(organizationId);
  const asOfDate=analysisDate(options.periodEnd),settled=await Promise.allSettled(POST_IMPORT_PIPELINES.map(definition=>supabase(`/rest/v1/rpc/${definition.rpc}`,{serviceRole:true,method:'POST',body:{p_organization_id:organizationId,p_as_of_date:asOfDate,p_horizon_days:definition.horizonDays}})));
  const results=settled.map((item,index)=>{
    const definition=POST_IMPORT_PIPELINES[index];
    return item.status==='fulfilled'?{key:definition.key,label:definition.label,status:'completed' as const,result:item.value.data}:{key:definition.key,label:definition.label,status:'failed' as const,error:String(item.reason?.message||item.reason||'분석 갱신 실패')};
  });
  return {...summarizePipelineResults(results),asOfDate};
}
