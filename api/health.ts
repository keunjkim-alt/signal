import {bodyJson,errorResponse,json} from './_lib/http.js';
import {normalizeClientMetrics,summarizeOperationsMonitoring} from './_lib/operations-monitoring.js';
import {sourceAssignmentUpdate,sourceOperationsView,validateImportRetry} from './_lib/operations-recovery.js';
import {audit,backendConfigured,downloadStorageObject,requestContext,requireRole,supabase,update} from './_lib/supabase.js';
import uploadHandler from './uploads/data.js';
import decisionsHandler from './_lib/handlers/decisions.js';
import inventoryPlanningHandler from './_lib/handlers/inventory-planning.js';
import outcomesRefreshHandler from './_lib/handlers/outcomes-refresh.js';
import outcomesCronHandler from './_lib/handlers/outcomes-cron.js';

const rows=async(table:string,params:Record<string,string>)=>(await supabase(`/rest/v1/${table}?${new URLSearchParams(params)}`,{serviceRole:true})).data||[];

async function operations(context:any,url:URL){
  requireRole(context,['owner','admin']);const org=context.membership.organization_id,windowDays=Math.min(30,Math.max(1,Number(url.searchParams.get('days'))||7)),since=new Date(Date.now()-windowDays*86400000).toISOString(),orgFilter=`eq.${org}`;
  const [telemetry,importJobs,analyticsRuns,sources,auditEvents,axMessages,queryCache,rawUploads,importErrors,recoveryEvents]=await Promise.all([
    rows('audit_logs',{organization_id:orgFilter,action:'eq.client.performance',created_at:`gte.${since}`,select:'id,metadata,created_at',order:'created_at.desc',limit:'500'}),
    rows('import_jobs',{organization_id:orgFilter,created_at:`gte.${since}`,select:'id,raw_upload_id,data_source_id,mapping_template_id,entity_type,status,total_rows,success_rows,error_rows,inserted_rows,updated_rows,completed_at,created_at,summary',order:'created_at.desc',limit:'200'}),
    rows('analytics_refresh_runs',{organization_id:orgFilter,started_at:`gte.${since}`,select:'id,pipeline,status,error_message,started_at,completed_at',order:'started_at.desc',limit:'200'}),
    rows('data_sources',{organization_id:orgFilter,select:'id,name,source_type,provider,status,data_mode,sync_mode,config,last_synced_at,last_successful_sync_at,last_sync_error',order:'last_synced_at.desc.nullslast',limit:'100'}),
    rows('audit_logs',{organization_id:orgFilter,created_at:`gte.${since}`,action:'eq.ax.router_fallback',select:'id,action,metadata,created_at',order:'created_at.desc',limit:'500'}),
    rows('ax_messages',{organization_id:orgFilter,role:'eq.assistant',created_at:`gte.${since}`,select:'id,model,source,page_key,created_at',order:'created_at.desc',limit:'2000'}),
    rows('ax_query_cache',{organization_id:orgFilter,created_at:`gte.${since}`,select:'id,page_key,model,hit_count,created_at,updated_at',order:'updated_at.desc',limit:'1000'}),
    rows('raw_uploads',{organization_id:orgFilter,created_at:`gte.${since}`,select:'id,original_filename,byte_size,status,created_at',order:'created_at.desc',limit:'300'}),
    rows('import_errors',{organization_id:orgFilter,created_at:`gte.${since}`,select:'id,import_job_id,row_number,field_name,error_code,message,created_at',order:'created_at.desc',limit:'500'}),
    rows('audit_logs',{organization_id:orgFilter,created_at:`gte.${since}`,action:'in.(data_source.synced,data_source.sync_failed,data_source.paused,data_source.resumed,data_source.assigned,file_import.retry_requested,file_import.retry_completed)',select:'id,actor_user_id,action,resource_type,resource_id,metadata,created_at',order:'created_at.desc',limit:'300'})
  ]);
  const uploadMap=new Map<string,any>(rawUploads.map((row:any)=>[String(row.id),row])),errorMap=new Map<string,any[]>();
  for(const error of importErrors){const list=errorMap.get(String(error.import_job_id))||[];list.push(error);errorMap.set(String(error.import_job_id),list)}
  const enrichedJobs=importJobs.map((job:any)=>({...job,filename:uploadMap.get(String(job.raw_upload_id))?.original_filename||'파일명 없음',byte_size:uploadMap.get(String(job.raw_upload_id))?.byte_size||0,errors:(errorMap.get(String(job.id))||[]).slice(0,5)}));
  return {...summarizeOperationsMonitoring({windowDays,telemetry,importJobs:enrichedJobs,analyticsRuns,sources:sources.map(sourceOperationsView),auditEvents,axMessages,queryCache}),recoveryEvents};
}

async function retryImport(request:Request,context:any,jobId:string){
  const org=context.membership.organization_id,jobQuery=new URLSearchParams({id:`eq.${jobId}`,organization_id:`eq.${org}`,select:'id,raw_upload_id,data_source_id,mapping_template_id,entity_type,status,summary',limit:'1'}),job=((await supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true})).data||[])[0],retry=validateImportRetry(job),uploadQuery=new URLSearchParams({id:`eq.${retry.uploadId}`,organization_id:`eq.${org}`,select:'id,original_filename,storage_path,content_type',limit:'1'}),upload=((await supabase(`/rest/v1/raw_uploads?${uploadQuery}`,{serviceRole:true})).data||[])[0];
  if(!upload?.storage_path)throw Object.assign(new Error('재실행할 원본 파일을 찾을 수 없습니다.'),{status:409});
  await audit(context,'file_import.retry_requested','import_job',retry.jobId,{entityType:retry.entityType,rawUploadId:retry.uploadId,sourceId:retry.sourceId||null});
  const bytes=await downloadStorageObject('raw-imports',upload.storage_path),file=new File([bytes],upload.original_filename||'retry.csv',{type:upload.content_type||'text/csv'}),form=new FormData();
  form.set('file',file);form.set('mode','import');form.set('entityType',retry.entityType);form.set('mapping',JSON.stringify(retry.mapping));if(retry.sourceId)form.set('sourceId',retry.sourceId);
  const headers=new Headers(),cookie=request.headers.get('cookie'),authorization=request.headers.get('authorization');if(cookie)headers.set('cookie',cookie);if(authorization)headers.set('authorization',authorization);headers.set('x-fashion-ax-org',org);
  const response=await uploadHandler.fetch(new Request('https://internal.viimsignal/api/uploads/data',{method:'POST',headers,body:form})),payload:any=await response.clone().json().catch(()=>({}));
  await audit(context,'file_import.retry_completed','import_job',retry.jobId,{entityType:retry.entityType,sourceId:retry.sourceId||null,retryJobId:payload?.job?.id||null,status:payload?.job?.status||payload?.error||response.status});
  return response;
}

async function assignSource(context:any,sourceId:string,membershipId:string){
  const org=context.membership.organization_id,sourceQuery=new URLSearchParams({id:`eq.${sourceId}`,organization_id:`eq.${org}`,select:'id,provider,status,config',limit:'1'}),membershipQuery=new URLSearchParams({id:`eq.${membershipId}`,organization_id:`eq.${org}`,select:'id,user_id,status',limit:'1'}),[sourceRows,membershipRows]=await Promise.all([supabase(`/rest/v1/data_sources?${sourceQuery}`,{serviceRole:true}),supabase(`/rest/v1/organization_memberships?${membershipQuery}`,{serviceRole:true})]),source=sourceRows.data?.[0],membership=membershipRows.data?.[0],values=sourceAssignmentUpdate(source,membership,context.user.id),updated=(await update('data_sources',{id:`eq.${sourceId}`,organization_id:`eq.${org}`},values))?.[0];
  await audit(context,'data_source.assigned','data_source',sourceId,{provider:source.provider,assigneeMembershipId:membership.id});
  return json({ok:true,source:sourceOperationsView(updated)});
}

export default {async fetch(request:Request){
  try{
    const url=new URL(request.url),resource=url.searchParams.get('resource');
    if(resource==='decisions')return decisionsHandler.fetch(request);
    if(resource==='inventory-planning')return inventoryPlanningHandler.fetch(request);
    if(resource==='outcomes-refresh')return outcomesRefreshHandler.fetch(request);
    if(resource==='outcomes-cron')return outcomesCronHandler.fetch(request);
    if(resource==='operations'){
      const context=await requestContext(request,{includeProfile:false,includeBrands:false,includePermissions:false});
      if(request.method==='GET')return json({ok:true,...await operations(context,url)});
      if(request.method==='POST'){
        const body=await bodyJson(request);
        if(body?.action==='retry_import'){requireRole(context,['owner','admin']);return retryImport(request,context,String(body?.jobId||''))}
        if(body?.action==='assign_source'){requireRole(context,['owner','admin']);return assignSource(context,String(body?.sourceId||''),String(body?.membershipId||''))}
        const entries=normalizeClientMetrics(body?.entries);
        if(!entries.length)return json({ok:true,accepted:0});
        await audit(context,'client.performance','browser_session',undefined,{schemaVersion:1,entries});
        return json({ok:true,accepted:entries.length},202);
      }
      return json({ok:false,error:'Method not allowed'},405);
    }
    return json({ok:true,service:'viimsignal-api',backendConfigured:backendConfigured(),openaiConfigured:Boolean(process.env.OPENAI_API_KEY),time:new Date().toISOString()});
  }catch(error:any){return errorResponse(error,error.status||500)}
}};
