import {bodyJson,errorResponse,json} from './_lib/http.js';
import {normalizeClientMetrics,summarizeOperationsMonitoring} from './_lib/operations-monitoring.js';
import {audit,backendConfigured,requestContext,requireRole,supabase} from './_lib/supabase.js';

const rows=async(table:string,params:Record<string,string>)=>(await supabase(`/rest/v1/${table}?${new URLSearchParams(params)}`,{serviceRole:true})).data||[];

async function operations(context:any,url:URL){
  requireRole(context,['owner','admin']);const org=context.membership.organization_id,windowDays=Math.min(30,Math.max(1,Number(url.searchParams.get('days'))||7)),since=new Date(Date.now()-windowDays*86400000).toISOString(),orgFilter=`eq.${org}`;
  const [telemetry,importJobs,analyticsRuns,sources,auditEvents,axMessages,queryCache]=await Promise.all([
    rows('audit_logs',{organization_id:orgFilter,action:'eq.client.performance',created_at:`gte.${since}`,select:'id,metadata,created_at',order:'created_at.desc',limit:'500'}),
    rows('import_jobs',{organization_id:orgFilter,created_at:`gte.${since}`,select:'id,entity_type,status,total_rows,success_rows,error_rows,inserted_rows,updated_rows,completed_at,created_at,summary',order:'created_at.desc',limit:'200'}),
    rows('analytics_refresh_runs',{organization_id:orgFilter,started_at:`gte.${since}`,select:'id,pipeline,status,error_message,started_at,completed_at',order:'started_at.desc',limit:'200'}),
    rows('data_sources',{organization_id:orgFilter,select:'id,name,provider,status,data_mode,last_synced_at,last_successful_sync_at,last_sync_error',order:'last_synced_at.desc.nullslast',limit:'100'}),
    rows('audit_logs',{organization_id:orgFilter,created_at:`gte.${since}`,action:'eq.ax.router_fallback',select:'id,action,metadata,created_at',order:'created_at.desc',limit:'500'}),
    rows('ax_messages',{organization_id:orgFilter,role:'eq.assistant',created_at:`gte.${since}`,select:'id,model,source,page_key,created_at',order:'created_at.desc',limit:'2000'}),
    rows('ax_query_cache',{organization_id:orgFilter,created_at:`gte.${since}`,select:'id,page_key,model,hit_count,created_at,updated_at',order:'updated_at.desc',limit:'1000'})
  ]);
  return summarizeOperationsMonitoring({windowDays,telemetry,importJobs,analyticsRuns,sources,auditEvents,axMessages,queryCache});
}

export default {async fetch(request:Request){
  try{
    const url=new URL(request.url),resource=url.searchParams.get('resource');
    if(resource==='operations'){
      const context=await requestContext(request,{includeProfile:false,includeBrands:false,includePermissions:false});
      if(request.method==='GET')return json({ok:true,...await operations(context,url)});
      if(request.method==='POST'){
        const body=await bodyJson(request),entries=normalizeClientMetrics(body?.entries);
        if(!entries.length)return json({ok:true,accepted:0});
        await audit(context,'client.performance','browser_session',undefined,{schemaVersion:1,entries});
        return json({ok:true,accepted:entries.length},202);
      }
      return json({ok:false,error:'Method not allowed'},405);
    }
    return json({ok:true,service:'viimsignal-api',backendConfigured:backendConfigured(),openaiConfigured:Boolean(process.env.OPENAI_API_KEY),time:new Date().toISOString()});
  }catch(error:any){return errorResponse(error,error.status||500)}
}};
