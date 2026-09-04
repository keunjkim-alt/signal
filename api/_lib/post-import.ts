import {supabase,update} from './supabase.js';
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

async function scopeLegacyAnalyticsResult(organizationId:string,workspaceId:string,asOfDate:string,key:string,result:any){
  const products=(await supabase(`/rest/v1/products?${new URLSearchParams({organization_id:`eq.${organizationId}`,workspace_id:`eq.${workspaceId}`,select:'id',limit:'10000'})}`,{serviceRole:true})).data||[],ids=products.map((row:any)=>String(row.id));
  if(!ids.length)return;
  for(let index=0;index<ids.length;index+=200){const batch=`in.(${ids.slice(index,index+200).join(',')})`;
    if(key==='sales_forecast')await update('forecast_snapshots',{organization_id:`eq.${organizationId}`,subject_type:'eq.product',subject_key:batch,as_of_date:`eq.${asOfDate}`},{workspace_id:workspaceId});
    if(key==='discount_optimization')await update('discount_recommendation_snapshots',{organization_id:`eq.${organizationId}`,product_id:batch,as_of_date:`eq.${asOfDate}`},{workspace_id:workspaceId});
  }
  if(result?.run_id)await update('analytics_refresh_runs',{id:`eq.${result.run_id}`,organization_id:`eq.${organizationId}`},{workspace_id:workspaceId});
}

export async function refreshPostImportAnalytics(organizationId:string,options:{periodEnd?:string|null;workspaceId?:string|null}={}){
  await assertAnalyticsRefreshAllowed(organizationId,options.workspaceId);
  const asOfDate=analysisDate(options.periodEnd),settled=await Promise.allSettled(POST_IMPORT_PIPELINES.map(definition=>supabase(`/rest/v1/rpc/${definition.rpc}`,{serviceRole:true,method:'POST',body:{p_organization_id:organizationId,p_as_of_date:asOfDate,p_horizon_days:definition.horizonDays}})));
  const results=await Promise.all(settled.map(async(item,index)=>{
    const definition=POST_IMPORT_PIPELINES[index];
    if(item.status==='rejected')return {key:definition.key,label:definition.label,status:'failed' as const,error:String(item.reason?.message||item.reason||'분석 갱신 실패')};
    try{if(options.workspaceId)await scopeLegacyAnalyticsResult(organizationId,options.workspaceId,asOfDate,definition.key,item.value.data);return {key:definition.key,label:definition.label,status:'completed' as const,result:item.value.data}}
    catch(error:any){return {key:definition.key,label:definition.label,status:'failed' as const,error:String(error?.message||error||'분석 결과 워크스페이스 귀속 실패')}}
  }));
  return {...summarizePipelineResults(results),asOfDate};
}
