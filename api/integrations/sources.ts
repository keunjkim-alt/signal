import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {audit,downloadStorageObject,insert,requestContext,requirePagePermission,requireRole,supabase,update,workspaceId} from '../_lib/supabase.js';
import {headerSignature,mappingFields,requiredMappingFields,sanitizeMapping} from '../_lib/mapping-templates.js';
import {inferMapping,parseWorkbook,validateAndNormalize} from '../_lib/wms.js';
import {inferSalesMapping,validateAndNormalizeSales} from '../_lib/sales.js';
import {buildReconciliation,inventoryControlTotals,persistedControlTotals,salesControlTotals,summarizeDataQuality} from '../_lib/reconciliation.js';
import {isSourceLifecycleAction,sourceLifecycleUpdate} from '../_lib/source-lifecycle.js';
import {inspectConnectorDraft,normalizeConnectorDraft} from '../_lib/connector-config.js';
import {credentialRegistry,probeConnector} from '../_lib/connector-runtime.js';
import {refreshPostImportAnalytics} from '../_lib/post-import.js';
import {cachedDashboardAggregate,invalidateDashboardCache} from '../_lib/dashboard-cache.js';

const SUPPORTED_MAPPINGS=['product_master','sales_order','inventory_snapshot','product_review'];
const CONNECTION_CACHE_TTL=12_000;

export default {async fetch(request:Request){
  try{
    const context=await requestContext(request,{includeProfile:false,includeBrands:false,permissionPage:'connections'}),org=context.membership.organization_id,ws=workspaceId(context),url=new URL(request.url),resource=url.searchParams.get('resource');
    if(request.method==='GET'){
      requirePagePermission(context,'connections','view');
      if(resource==='imports')return json(await cachedDashboardAggregate(context,`connection-imports:${Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||20))}`,CONNECTION_CACHE_TTL,()=>importHistory(org,ws,url)));
      if(resource==='import-errors')return importErrors(org,ws,url);
      if(resource==='reconciliation')return reconciliationStatus(org,ws,url.searchParams.get('refresh')==='1');
      if(resource==='data-quality')return dataQualityStatus(org,ws);
      if(resource==='mappings'){
        const entityType=String(url.searchParams.get('entityType')||'');
        if(entityType&&!SUPPORTED_MAPPINGS.includes(entityType))return json({ok:false,error:'지원하지 않는 데이터 유형입니다.'},400);
        const query=new URLSearchParams({organization_id:`eq.${org}`,active:'eq.true',select:'id,name,entity_type,header_signature,mapping,transformations,version,data_source_id,created_at',order:'created_at.desc',limit:'100'});if(ws)query.set('workspace_id',`eq.${ws}`);
        if(entityType)query.set('entity_type',`eq.${entityType}`);
        const templates=(await supabase(`/rest/v1/mapping_templates?${query}`,{serviceRole:true})).data||[];
        return json({ok:true,templates,fields:entityType?mappingFields(entityType):{product_master:mappingFields('product_master'),sales_order:mappingFields('sales_order'),inventory_snapshot:mappingFields('inventory_snapshot'),product_review:mappingFields('product_review')}});
      }
      return json(await cachedDashboardAggregate(context,'connection-sources',CONNECTION_CACHE_TTL,async()=>{const query=new URLSearchParams({organization_id:`eq.${org}`,select:'id,brand_id,source_type,provider,name,status,data_mode,sync_mode,schedule,config,last_synced_at,last_successful_sync_at,last_sync_error,created_at,updated_at',order:'created_at.desc'});if(ws)query.set('workspace_id',`eq.${ws}`);const sources=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data;return {ok:true,sources}}));
    }
    if(request.method==='POST'){
      invalidateDashboardCache(org);
      requirePagePermission(context,'connections','update');const body=await bodyJson(request);
      if(body?.action==='save_mapping')return saveMapping(context,org,ws,body);
      if(body?.action==='test_connection')return testConnection(body);
      if(body?.action==='rollback_import')return rollbackImport(context,org,ws,body);
      if(body?.action==='preview_demo_cleanup')return previewDemoCleanup(context,org);
      if(body?.action==='cleanup_demo_legacy')return cleanupDemoLegacy(context,org,body);
      if(body?.action==='create_source'){
        const draft=normalizeConnectorDraft(body),rows=await insert('data_sources',{organization_id:org,workspace_id:ws,brand_id:body.brand_id||context.workspace?.brand_id||null,source_type:draft.source_type,provider:draft.provider,name:draft.name,status:'draft',data_mode:'stale',sync_mode:draft.sync_mode,schedule:draft.schedule,config:draft.config,created_by:context.user.id});
        await audit(context,'data_source.created','data_source',rows?.[0]?.id,{provider:draft.provider,entity_type:draft.entity_type,activation:'registered_pending_sync'});return json({ok:true,source:rows?.[0],activation:'registered_pending_sync'},201);
      }
      if(!body?.name||!body?.provider||!body?.source_type)return json({ok:false,error:'name, provider and source_type are required'},400);
      const rows=await insert('data_sources',{organization_id:org,workspace_id:ws,brand_id:body.brand_id||context.workspace?.brand_id||null,source_type:body.source_type,provider:body.provider,name:body.name,status:'draft',sync_mode:body.sync_mode||'manual',schedule:body.schedule||null,config:body.config||{},created_by:context.user.id});
      await audit(context,'data_source.created','data_source',rows?.[0]?.id,{provider:body.provider});return json({ok:true,source:rows?.[0]},201);
    }
    if(request.method==='PATCH'){
      invalidateDashboardCache(org);
      requirePagePermission(context,'connections','update');const body=await bodyJson(request),sourceId=String(body?.sourceId||''),action=String(body?.action||'');
      if(!sourceId||!isSourceLifecycleAction(action))return json({ok:false,error:'sourceId와 유효한 action이 필요합니다.'},400);
      if(['archive','restore'].includes(action))requireRole(context,['owner','admin']);
      const sourceQuery=new URLSearchParams({id:`eq.${sourceId}`,organization_id:`eq.${org}`,select:'id,name,provider,status,config',limit:'1'});if(ws)sourceQuery.set('workspace_id',`eq.${ws}`);const source=((await supabase(`/rest/v1/data_sources?${sourceQuery}`,{serviceRole:true})).data||[])[0];
      if(!source)return json({ok:false,error:'데이터 소스를 찾을 수 없습니다.'},404);
      const values=sourceLifecycleUpdate(source,action,context.user.id),updated=(await update('data_sources',{id:`eq.${sourceId}`,organization_id:`eq.${org}`,...(ws?{workspace_id:`eq.${ws}`}:{})},values))?.[0];
      await audit(context,`data_source.${action}d`,'data_source',sourceId,{provider:source.provider,previous_status:source.status,next_status:updated?.status||values.status});
      return json({ok:true,source:updated});
    }
    return json({ok:false,error:'Method not allowed'},405);
  }catch(error:any){return errorResponse(error,error.status||500)}
}};

async function testConnection(body:any){
  const inspected:any=inspectConnectorDraft(body),normalized=inspected.normalized,connection=normalized.config.connection,hasCredential=normalized.source_type==='sheet'||Boolean(credentialRegistry()[connection.credential_ref]);
  if(!hasCredential)return json({ok:true,test:{...inspected,runtime:{status:'pending',message:`Vercel의 VIIMSIGNAL_CONNECTOR_CREDENTIALS에 '${connection.credential_ref}'를 등록하면 실제 연결 검사가 활성화됩니다.`}}});
  const probe=await probeConnector({name:normalized.name,source_type:normalized.source_type,provider:normalized.provider,config:normalized.config});
  inspected.checks=inspected.checks.map((check:any)=>check.key==='worker'?{key:'worker',label:'원천 연결',status:'passed',message:`${probe.filename} · ${probe.byteSize.toLocaleString()} bytes · 헤더 ${probe.headers.length}개 확인`}:check);
  return json({ok:true,test:{...inspected,activation:'ready_to_sync',runtime:{status:'passed',...probe}}});
}

async function saveMapping(context:any,org:string,ws:string|null,body:any){
  const entityType=String(body?.entityType||''),headers=Array.isArray(body?.headers)?body.headers.map(String):[];
  if(!SUPPORTED_MAPPINGS.includes(entityType))return json({ok:false,error:'지원하지 않는 데이터 유형입니다.'},400);
  if(!headers.length)return json({ok:false,error:'headers가 필요합니다.'},400);
  const mapping=sanitizeMapping(entityType,headers,body?.mapping),missing=requiredMappingFields(entityType).filter(field=>!mapping[field]);
  if(missing.length)return json({ok:false,error:`필수 매핑이 누락되었습니다: ${missing.join(', ')}`},422);
  const sourceId=body?.sourceId?String(body.sourceId):null;
  if(sourceId){const sourceQuery=new URLSearchParams({id:`eq.${sourceId}`,organization_id:`eq.${org}`,select:'id',limit:'1'});if(ws)sourceQuery.set('workspace_id',`eq.${ws}`);const source=((await supabase(`/rest/v1/data_sources?${sourceQuery}`,{serviceRole:true})).data||[])[0];if(!source)return json({ok:false,error:'선택한 데이터 소스를 찾을 수 없습니다.'},404)}
  const signature=await headerSignature(headers),existing=await findTemplate(org,ws,entityType,signature,sourceId),typeLabel=entityType==='product_master'?'상품 마스터':entityType==='sales_order'?'판매':entityType==='product_review'?'리뷰·VOC':'재고',name=String(body?.name||`${typeLabel} · ${headers.slice(0,3).join(' / ')}`).trim().slice(0,120),transformations=body?.transformations&&typeof body.transformations==='object'?body.transformations:{};
  const template=existing?(await update('mapping_templates',{id:`eq.${existing.id}`,organization_id:`eq.${org}`,...(ws?{workspace_id:`eq.${ws}`}:{})},{name,mapping,transformations,version:Number(existing.version||1)+1,active:true}))?.[0]:(await insert('mapping_templates',{organization_id:org,workspace_id:ws,data_source_id:sourceId,name,entity_type:entityType,header_signature:signature,mapping,transformations,version:1,active:true,created_by:context.user.id}))?.[0];
  await audit(context,'mapping_template.saved','mapping_template',template.id,{entityType,headerSignature:signature,version:template.version,sourceId,fields:Object.keys(mapping)});
  return json({ok:true,template:{id:template.id,name:template.name,entityType:template.entity_type,headerSignature:template.header_signature,mapping:template.mapping,version:template.version,dataSourceId:template.data_source_id}},existing?200:201);
}

async function rollbackImport(context:any,org:string,ws:string|null,body:any){
  requireRole(context,['owner','admin']);
  const jobId=String(body?.jobId||'');
  if(!jobId||body?.confirmation!=='ROLLBACK')return json({ok:false,error:'되돌릴 적재 건과 확인 문구가 필요합니다.'},400);
  const jobQuery=new URLSearchParams({id:`eq.${jobId}`,organization_id:`eq.${org}`,select:'id,raw_upload_id,entity_type,status,summary',limit:'1'});if(ws)jobQuery.set('workspace_id',`eq.${ws}`);const job=((await supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true})).data||[])[0];
  if(!job)return json({ok:false,error:'적재 작업을 찾을 수 없습니다.'},404);
  if(job.summary?.rollback?.rolled_back_at)return json({ok:true,idempotent:true,job});
  if(!job.raw_upload_id)return json({ok:false,error:'원본 업로드 식별자가 없어 안전하게 되돌릴 수 없습니다.'},409);
  const uploadFilter=`organization_id=eq.${encodeURIComponent(org)}&${ws?`workspace_id=eq.${encodeURIComponent(ws)}&`:''}raw_upload_id=eq.${encodeURIComponent(job.raw_upload_id)}`;
  let deletedLines=0,deletedOrders=0,deletedSnapshots=0,deletedReviews=0;
  if(job.entity_type==='sales_order'){
    deletedLines=((await supabase(`/rest/v1/sales_order_lines?${uploadFilter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
    deletedOrders=((await supabase(`/rest/v1/sales_orders?${uploadFilter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
  }else if(job.entity_type==='inventory_snapshot'){
    deletedSnapshots=((await supabase(`/rest/v1/inventory_snapshots?${uploadFilter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
  }else if(job.entity_type==='product_review'){
    deletedReviews=((await supabase(`/rest/v1/product_reviews?${uploadFilter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
  }else return json({ok:false,error:'상품 마스터를 제외한 판매·재고·리뷰 적재만 되돌릴 수 있습니다.'},422);
  const rolledBackAt=new Date().toISOString(),summary={...(job.summary||{}),rollback:{rolled_back_at:rolledBackAt,rolled_back_by:context.user.id,deleted_lines:deletedLines,deleted_orders:deletedOrders,deleted_snapshots:deletedSnapshots,deleted_reviews:deletedReviews}},updated=(await update('import_jobs',{id:`eq.${job.id}`,organization_id:`eq.${org}`,...(ws?{workspace_id:`eq.${ws}`}:{})},{status:'failed',completed_at:rolledBackAt,summary}))?.[0];
  await audit(context,'file_import.rolled_back','import_job',job.id,{entityType:job.entity_type,rawUploadId:job.raw_upload_id,deletedLines,deletedOrders,deletedSnapshots,deletedReviews});
  return json({ok:true,job:updated,deleted:{salesLines:deletedLines,salesOrders:deletedOrders,inventorySnapshots:deletedSnapshots,reviews:deletedReviews}});
}

async function previewDemoCleanup(context:any,org:string){
  requireRole(context,['owner','admin']);
  const [counts,salesContributions]=await Promise.all([legacyDemoCounts(org),recentSalesContributions(org)]);
  return json({ok:true,counts,total:counts.salesOrders+counts.salesLines+counts.inventorySnapshots,salesContributions,scope:'untracked_source_rows',preserved:['registered_imports','raw_uploads','import_jobs','users','permissions','audit_logs','approved_actions']});
}

async function cleanupDemoLegacy(context:any,org:string,body:any){
  requireRole(context,['owner','admin']);
  if(body?.confirmation!=='DEMO CLEANUP')return json({ok:false,error:'확인 문구가 일치하지 않습니다.'},400);
  const before=await legacyDemoCounts(org),filter=`organization_id=eq.${encodeURIComponent(org)}&raw_upload_id=is.null`,deleted:any={salesLines:0,salesOrders:0,inventorySnapshots:0,forecastSnapshots:0,discountRecommendations:0,featureSnapshots:0,queryCache:0};
  deleted.salesLines=((await supabase(`/rest/v1/sales_order_lines?${filter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
  deleted.salesOrders=((await supabase(`/rest/v1/sales_orders?${filter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
  deleted.inventorySnapshots=((await supabase(`/rest/v1/inventory_snapshots?${filter}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length;
  for(const [table,key] of [['forecast_snapshots','forecastSnapshots'],['discount_recommendation_snapshots','discountRecommendations'],['analysis_feature_snapshots','featureSnapshots'],['ax_query_cache','queryCache']] as const){
    try{deleted[key]=((await supabase(`/rest/v1/${table}?organization_id=eq.${encodeURIComponent(org)}`,{serviceRole:true,method:'DELETE',headers:{Prefer:'return=representation'}})).data||[]).length}catch{}
  }
  const latestQuery=new URLSearchParams({organization_id:`eq.${org}`,raw_upload_id:'not.is.null',select:'ordered_at',order:'ordered_at.desc',limit:'1'}),latest=((await supabase(`/rest/v1/sales_orders?${latestQuery}`,{serviceRole:true})).data||[])[0]?.ordered_at;
  let analytics:any={status:'skipped',reason:'NO_REGISTERED_SALES'};
  if(latest)try{analytics=await refreshPostImportAnalytics(org,{periodEnd:latest})}catch(error:any){analytics={status:'failed',error:String(error?.message||error)}}
  await audit(context,'demo_legacy.cleaned','organization',org,{before,deleted,analytics:{status:analytics.status,completed:analytics.completed,failed:analytics.failed,asOfDate:analytics.asOfDate},preserved:['registered_imports','users','permissions','audit_logs','approved_actions']});
  return json({ok:true,before,deleted,analytics,preserved:['registered_imports','raw_uploads','import_jobs','users','permissions','audit_logs','approved_actions']});
}

async function legacyDemoCounts(org:string){
  const [salesOrders,salesLines,inventorySnapshots]=await Promise.all([
    exactCount('sales_orders',org,'raw_upload_id=is.null'),
    exactCount('sales_order_lines',org,'raw_upload_id=is.null'),
    exactCount('inventory_snapshots',org,'raw_upload_id=is.null')
  ]);
  return {salesOrders,salesLines,inventorySnapshots};
}

async function exactCount(table:string,org:string,extra:string){
  const {response}=await supabase(`/rest/v1/${table}?organization_id=eq.${encodeURIComponent(org)}&${extra}&select=id`,{serviceRole:true,headers:{Prefer:'count=exact',Range:'0-0'}}),range=response.headers.get('content-range')||'';
  const total=Number(range.split('/')[1]);return Number.isFinite(total)?total:0;
}

async function recentSalesContributions(org:string){
  const jobQuery=new URLSearchParams({organization_id:`eq.${org}`,entity_type:'eq.sales_order',select:'id,raw_upload_id,status,summary,created_at',order:'created_at.desc',limit:'100'}),jobs=(await supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true})).data||[],active=jobs.filter((job:any)=>job.raw_upload_id&&!job.summary?.rollback?.rolled_back_at),uploadIds=[...new Set(active.map((job:any)=>job.raw_upload_id))];
  const uploads=uploadIds.length?(await supabase(`/rest/v1/raw_uploads?organization_id=eq.${encodeURIComponent(org)}&id=${encodeURIComponent(`in.(${uploadIds.join(',')})`)}&select=id,original_filename`,{serviceRole:true})).data||[]:[],uploadMap=new Map(uploads.map((row:any)=>[String(row.id),row.original_filename]));
  return active.map((job:any)=>{const control=job.summary?.persistedControl||job.summary?.sourceControl||{};return {jobId:job.id,rawUploadId:job.raw_upload_id,filename:uploadMap.get(String(job.raw_upload_id))||'등록 파일',status:job.status,orders:Number(control.orders||0),rows:Number(control.rows||0),netSales:Number(control.netSales||0),createdAt:job.created_at}}).filter((row:any)=>row.orders||row.rows).sort((a:any,b:any)=>b.createdAt.localeCompare(a.createdAt));
}

async function findTemplate(org:string,ws:string|null,entityType:string,signature:string,sourceId:string|null){
  if(sourceId){const specific=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:`eq.${sourceId}`,active:'eq.true',select:'id,version',order:'version.desc,created_at.desc',limit:'1'});if(ws)specific.set('workspace_id',`eq.${ws}`);const row=((await supabase(`/rest/v1/mapping_templates?${specific}`,{serviceRole:true})).data||[])[0];if(row)return row}
  const generic=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:'is.null',active:'eq.true',select:'id,version',order:'version.desc,created_at.desc',limit:'1'});if(ws)generic.set('workspace_id',`eq.${ws}`);
  return ((await supabase(`/rest/v1/mapping_templates?${generic}`,{serviceRole:true})).data||[])[0]||null;
}

async function importHistory(org:string,ws:string|null,url:URL){
  const now=new Date(),staleBefore=new Date(now.getTime()-5*60*1000).toISOString(),limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||20)),jobQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'id,raw_upload_id,data_source_id,mapping_template_id,entity_type,status,total_rows,success_rows,error_rows,inserted_rows,updated_rows,unchanged_rows,summary,started_at,completed_at,created_at',order:'created_at.desc',limit:String(limit)}),runQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'id,pipeline,scope_date,status,input_rows,output_rows,source_watermark,error_message,started_at,completed_at',order:'started_at.desc',limit:'40'});if(ws){jobQuery.set('workspace_id',`eq.${ws}`);runQuery.set('workspace_id',`eq.${ws}`)}
  const [jobsResult,runsResult]=await Promise.all([
    supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true}),
    supabase(`/rest/v1/analytics_refresh_runs?${runQuery}`,{serviceRole:true})
  ]),jobs=jobsResult.data||[],analyticsRuns=runsResult.data||[],uploadIds=jobs.map((row:any)=>row.raw_upload_id).filter(Boolean),jobIds=jobs.map((row:any)=>row.id),staleJobs=jobs.filter((row:any)=>row.status==='processing'&&row.started_at&&row.started_at<staleBefore);
  const [uploads,errors]=await Promise.all([
    uploadIds.length?supabase(`/rest/v1/raw_uploads?organization_id=eq.${encodeURIComponent(org)}&${ws?`workspace_id=eq.${encodeURIComponent(ws)}&`:''}id=${encodeURIComponent(`in.(${uploadIds.join(',')})`)}&select=id,original_filename,byte_size,created_at`,{serviceRole:true}).then(result=>result.data||[]):Promise.resolve([]),
    jobIds.length?supabase(`/rest/v1/import_errors?organization_id=eq.${encodeURIComponent(org)}&${ws?`workspace_id=eq.${encodeURIComponent(ws)}&`:''}import_job_id=${encodeURIComponent(`in.(${jobIds.join(',')})`)}&select=id,import_job_id,row_number,field_name,error_code,message,created_at&order=created_at.desc&limit=100`,{serviceRole:true}).then(result=>result.data||[]):Promise.resolve([]),
    staleJobs.length?update('import_jobs',{organization_id:`eq.${org}`,...(ws?{workspace_id:`eq.${ws}`}:{}) ,status:'eq.processing',started_at:`lt.${staleBefore}`},{status:'failed',completed_at:now.toISOString()}).catch(()=>[]):Promise.resolve([])
  ]),staleIds=new Set(staleJobs.map((row:any)=>row.id)),uploadMap=new Map<string,any>(uploads.map((row:any)=>[String(row.id),row])),errorMap=new Map<string,any[]>();
  for(const error of errors){const list=errorMap.get(error.import_job_id)||[];list.push(error);errorMap.set(error.import_job_id,list)}
  return {ok:true,jobs:jobs.map((row:any)=>({...row,...(staleIds.has(row.id)?{status:'failed',completed_at:now.toISOString()}:{}),filename:uploadMap.get(String(row.raw_upload_id))?.original_filename||'파일명 없음',byte_size:uploadMap.get(String(row.raw_upload_id))?.byte_size||0,errors:(errorMap.get(row.id)||[]).slice(0,5)})),analyticsRuns};
}

async function importErrors(org:string,ws:string|null,url:URL){
  const jobId=String(url.searchParams.get('jobId')||'');if(!jobId)return json({ok:false,error:'jobId가 필요합니다.'},400);
  const jobQuery=new URLSearchParams({id:`eq.${jobId}`,organization_id:`eq.${org}`,select:'id',limit:'1'});if(ws)jobQuery.set('workspace_id',`eq.${ws}`);const job=((await supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true})).data||[])[0];if(!job)return json({ok:false,error:'적재 작업을 찾을 수 없습니다.'},404);
  const query=new URLSearchParams({organization_id:`eq.${org}`,import_job_id:`eq.${jobId}`,select:'row_number,field_name,error_code,message,raw_row,created_at',order:'row_number.asc',limit:'10000'});if(ws)query.set('workspace_id',`eq.${ws}`);const errors=(await supabase(`/rest/v1/import_errors?${query}`,{serviceRole:true})).data||[];
  return json({ok:true,jobId,errors});
}

async function reconciliationStatus(org:string,ws:string|null,refresh=false){
  const query=new URLSearchParams({organization_id:`eq.${org}`,status:'in.(completed,partial)',entity_type:'in.(sales_order,inventory_snapshot)',select:'id,workspace_id,raw_upload_id,entity_type,status,total_rows,success_rows,error_rows,summary,completed_at,created_at',order:'created_at.desc',limit:'40'});if(ws)query.set('workspace_id',`eq.${ws}`);const jobs=(await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[],latest=['sales_order','inventory_snapshot'].map(type=>jobs.find((job:any)=>job.entity_type===type)).filter(Boolean),uploadIds=latest.map((job:any)=>job.raw_upload_id).filter(Boolean),uploadQuery=uploadIds.length?`organization_id=eq.${encodeURIComponent(org)}&${ws?`workspace_id=eq.${encodeURIComponent(ws)}&`:''}id=${encodeURIComponent(`in.(${uploadIds.join(',')})`)}&select=id,original_filename,storage_path,content_type`:null,uploads=uploadQuery?(await supabase(`/rest/v1/raw_uploads?${uploadQuery}`,{serviceRole:true})).data||[]:[],uploadMap=new Map(uploads.map((row:any)=>[String(row.id),row])),items=[];
  for(const job of latest){
    const upload:any=uploadMap.get(String(job.raw_upload_id));
    try{
      if(!refresh&&job.summary?.reconciliation&&job.summary?.sourceControl&&job.summary?.persistedControl){
        items.push({...job.summary.reconciliation,jobStatus:job.status,totalRows:Number(job.total_rows||0),successRows:Number(job.success_rows||0),errorRows:Number(job.error_rows||0),sourceMode:'stored_control'});
        continue;
      }
      const source=job.summary?.sourceControl||await sourceTotalsFromUpload(job,upload),persisted=await persistedControlTotals(org,job),result=buildReconciliation(job.entity_type,source,persisted,{filename:upload?.original_filename||null,jobId:job.id});
      await update('import_jobs',{id:`eq.${job.id}`,organization_id:`eq.${org}`,...(ws?{workspace_id:`eq.${ws}`}:{})},{summary:{...(job.summary||{}),sourceControl:source,persistedControl:persisted,reconciliation:result}});
      items.push({...result,jobStatus:job.status,totalRows:Number(job.total_rows||0),successRows:Number(job.success_rows||0),errorRows:Number(job.error_rows||0),sourceMode:job.summary?.sourceControl?'stored_control':'raw_file_replay'});
    }catch(error:any){items.push({entityType:job.entity_type,status:'unavailable',matched:false,checkedAt:new Date().toISOString(),filename:upload?.original_filename||null,jobId:job.id,jobStatus:job.status,totalRows:Number(job.total_rows||0),successRows:Number(job.success_rows||0),errorRows:Number(job.error_rows||0),source:null,persisted:null,checks:[],error:String(error?.message||error||'정합성 검증 실패')})}
  }
  const status=items.some((item:any)=>item.status==='mismatch')?'mismatch':items.length&&items.every((item:any)=>item.status==='matched')?'matched':items.some((item:any)=>item.status==='matched')?'partial':'unavailable';
  return json({ok:true,status,checkedAt:new Date().toISOString(),items});
}

async function sourceTotalsFromUpload(job:any,upload:any){
  if(!upload?.storage_path)throw new Error('원본 파일 경로가 없습니다.');
  const bytes=await downloadStorageObject('raw-imports',upload.storage_path),file={name:upload.original_filename||'upload.csv',arrayBuffer:async()=>bytes} as File,rows=await parseWorkbook(file),mapping=job.summary?.mapping||(job.entity_type==='sales_order'?inferSalesMapping(Object.keys(rows[0]||{})):inferMapping(Object.keys(rows[0]||{}))),validation=job.entity_type==='sales_order'?validateAndNormalizeSales(rows,mapping):validateAndNormalize(rows,mapping);
  if(validation.missingFields?.length)throw new Error(`원본 컬럼 매핑 누락: ${validation.missingFields.join(', ')}`);
  return job.entity_type==='sales_order'?salesControlTotals(validation.validRows):inventoryControlTotals(validation.validRows);
}

async function dataQualityStatus(org:string,ws:string|null){
  const query=new URLSearchParams({organization_id:`eq.${org}`,status:'in.(completed,partial)',entity_type:'in.(sales_order,inventory_snapshot)',select:'id,entity_type,status,total_rows,success_rows,error_rows,summary,completed_at,created_at',order:'created_at.desc',limit:'40'});if(ws)query.set('workspace_id',`eq.${ws}`);const jobs=(await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[],latest=['sales_order','inventory_snapshot'].map(type=>jobs.find((job:any)=>job.entity_type===type)).filter(Boolean),items=latest.map((job:any)=>({jobId:job.id,entityType:job.entity_type,jobStatus:job.status,filename:job.summary?.reconciliation?.filename||null,reconciliation:job.summary?.reconciliation||null,completedAt:job.completed_at||job.created_at})),summary=summarizeDataQuality(items);
  return json({ok:true,...summary,items,checkedAt:new Date().toISOString()});
}
