import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {audit,downloadStorageObject,insert,requestContext,requirePagePermission,supabase,update} from '../_lib/supabase.js';
import {headerSignature,mappingFields,requiredMappingFields,sanitizeMapping} from '../_lib/mapping-templates.js';
import {inferMapping,parseWorkbook,validateAndNormalize} from '../_lib/wms.js';
import {inferSalesMapping,validateAndNormalizeSales} from '../_lib/sales.js';
import {buildReconciliation,inventoryControlTotals,persistedControlTotals,salesControlTotals,summarizeDataQuality} from '../_lib/reconciliation.js';

const SUPPORTED_MAPPINGS=['sales_order','inventory_snapshot'];

export default {async fetch(request:Request){
  try{
    const context=await requestContext(request),org=context.membership.organization_id,url=new URL(request.url),resource=url.searchParams.get('resource');
    if(request.method==='GET'){
      requirePagePermission(context,'connections','view');
      if(resource==='imports')return importHistory(org,url);
      if(resource==='import-errors')return importErrors(org,url);
      if(resource==='reconciliation')return reconciliationStatus(org);
      if(resource==='data-quality')return dataQualityStatus(org);
      if(resource==='mappings'){
        const entityType=String(url.searchParams.get('entityType')||'');
        if(entityType&&!SUPPORTED_MAPPINGS.includes(entityType))return json({ok:false,error:'지원하지 않는 데이터 유형입니다.'},400);
        const query=new URLSearchParams({organization_id:`eq.${org}`,active:'eq.true',select:'id,name,entity_type,header_signature,mapping,transformations,version,data_source_id,created_at',order:'created_at.desc',limit:'100'});
        if(entityType)query.set('entity_type',`eq.${entityType}`);
        const templates=(await supabase(`/rest/v1/mapping_templates?${query}`,{serviceRole:true})).data||[];
        return json({ok:true,templates,fields:entityType?mappingFields(entityType):{sales_order:mappingFields('sales_order'),inventory_snapshot:mappingFields('inventory_snapshot')}});
      }
      const query=new URLSearchParams({organization_id:`eq.${org}`,select:'id,brand_id,source_type,provider,name,status,data_mode,sync_mode,schedule,last_synced_at,last_successful_sync_at,last_sync_error,created_at',order:'created_at.desc'}),sources=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data;
      return json({ok:true,sources});
    }
    if(request.method==='POST'){
      requirePagePermission(context,'connections','update');const body=await bodyJson(request);
      if(body?.action==='save_mapping')return saveMapping(context,org,body);
      if(!body?.name||!body?.provider||!body?.source_type)return json({ok:false,error:'name, provider and source_type are required'},400);
      const rows=await insert('data_sources',{organization_id:org,brand_id:body.brand_id||null,source_type:body.source_type,provider:body.provider,name:body.name,status:'draft',sync_mode:body.sync_mode||'manual',schedule:body.schedule||null,config:body.config||{},created_by:context.user.id});
      await audit(context,'data_source.created','data_source',rows?.[0]?.id,{provider:body.provider});return json({ok:true,source:rows?.[0]},201);
    }
    return json({ok:false,error:'Method not allowed'},405);
  }catch(error:any){return errorResponse(error,error.status||500)}
}};

async function saveMapping(context:any,org:string,body:any){
  const entityType=String(body?.entityType||''),headers=Array.isArray(body?.headers)?body.headers.map(String):[];
  if(!SUPPORTED_MAPPINGS.includes(entityType))return json({ok:false,error:'지원하지 않는 데이터 유형입니다.'},400);
  if(!headers.length)return json({ok:false,error:'headers가 필요합니다.'},400);
  const mapping=sanitizeMapping(entityType,headers,body?.mapping),missing=requiredMappingFields(entityType).filter(field=>!mapping[field]);
  if(missing.length)return json({ok:false,error:`필수 매핑이 누락되었습니다: ${missing.join(', ')}`},422);
  const sourceId=body?.sourceId?String(body.sourceId):null;
  if(sourceId){const sourceQuery=new URLSearchParams({id:`eq.${sourceId}`,organization_id:`eq.${org}`,select:'id',limit:'1'}),source=((await supabase(`/rest/v1/data_sources?${sourceQuery}`,{serviceRole:true})).data||[])[0];if(!source)return json({ok:false,error:'선택한 데이터 소스를 찾을 수 없습니다.'},404)}
  const signature=await headerSignature(headers),existing=await findTemplate(org,entityType,signature,sourceId),name=String(body?.name||`${entityType==='sales_order'?'판매':'재고'} · ${headers.slice(0,3).join(' / ')}`).trim().slice(0,120),transformations=body?.transformations&&typeof body.transformations==='object'?body.transformations:{};
  const template=existing?(await update('mapping_templates',{id:`eq.${existing.id}`,organization_id:`eq.${org}`},{name,mapping,transformations,version:Number(existing.version||1)+1,active:true}))?.[0]:(await insert('mapping_templates',{organization_id:org,data_source_id:sourceId,name,entity_type:entityType,header_signature:signature,mapping,transformations,version:1,active:true,created_by:context.user.id}))?.[0];
  await audit(context,'mapping_template.saved','mapping_template',template.id,{entityType,headerSignature:signature,version:template.version,sourceId,fields:Object.keys(mapping)});
  return json({ok:true,template:{id:template.id,name:template.name,entityType:template.entity_type,headerSignature:template.header_signature,mapping:template.mapping,version:template.version,dataSourceId:template.data_source_id}},existing?200:201);
}

async function findTemplate(org:string,entityType:string,signature:string,sourceId:string|null){
  if(sourceId){const specific=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:`eq.${sourceId}`,active:'eq.true',select:'id,version',order:'version.desc,created_at.desc',limit:'1'}),row=((await supabase(`/rest/v1/mapping_templates?${specific}`,{serviceRole:true})).data||[])[0];if(row)return row}
  const generic=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:'is.null',active:'eq.true',select:'id,version',order:'version.desc,created_at.desc',limit:'1'});
  return ((await supabase(`/rest/v1/mapping_templates?${generic}`,{serviceRole:true})).data||[])[0]||null;
}

async function importHistory(org:string,url:URL){
  const now=new Date(),staleBefore=new Date(now.getTime()-5*60*1000).toISOString();
  try{await update('import_jobs',{organization_id:`eq.${org}`,status:'eq.processing',started_at:`lt.${staleBefore}`},{status:'failed',completed_at:now.toISOString()})}catch{}
  const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||20)),jobQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'id,raw_upload_id,data_source_id,mapping_template_id,entity_type,status,total_rows,success_rows,error_rows,inserted_rows,updated_rows,unchanged_rows,summary,started_at,completed_at,created_at',order:'created_at.desc',limit:String(limit)}),jobs=(await supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true})).data||[],uploadIds=jobs.map((row:any)=>row.raw_upload_id).filter(Boolean),jobIds=jobs.map((row:any)=>row.id),uploads=uploadIds.length?(await supabase(`/rest/v1/raw_uploads?organization_id=eq.${encodeURIComponent(org)}&id=${encodeURIComponent(`in.(${uploadIds.join(',')})`)}&select=id,original_filename,byte_size,created_at`,{serviceRole:true})).data||[]:[],errors=jobIds.length?(await supabase(`/rest/v1/import_errors?organization_id=eq.${encodeURIComponent(org)}&import_job_id=${encodeURIComponent(`in.(${jobIds.join(',')})`)}&select=id,import_job_id,row_number,field_name,error_code,message,created_at&order=created_at.desc&limit=100`,{serviceRole:true})).data||[]:[],runQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'id,pipeline,scope_date,status,input_rows,output_rows,source_watermark,error_message,started_at,completed_at',order:'started_at.desc',limit:'40'}),analyticsRuns=(await supabase(`/rest/v1/analytics_refresh_runs?${runQuery}`,{serviceRole:true})).data||[],uploadMap=new Map<string,any>(uploads.map((row:any)=>[String(row.id),row])),errorMap=new Map<string,any[]>();
  for(const error of errors){const list=errorMap.get(error.import_job_id)||[];list.push(error);errorMap.set(error.import_job_id,list)}
  return json({ok:true,jobs:jobs.map((row:any)=>({...row,filename:uploadMap.get(String(row.raw_upload_id))?.original_filename||'파일명 없음',byte_size:uploadMap.get(String(row.raw_upload_id))?.byte_size||0,errors:(errorMap.get(row.id)||[]).slice(0,5)})),analyticsRuns});
}

async function importErrors(org:string,url:URL){
  const jobId=String(url.searchParams.get('jobId')||'');if(!jobId)return json({ok:false,error:'jobId가 필요합니다.'},400);
  const jobQuery=new URLSearchParams({id:`eq.${jobId}`,organization_id:`eq.${org}`,select:'id',limit:'1'}),job=((await supabase(`/rest/v1/import_jobs?${jobQuery}`,{serviceRole:true})).data||[])[0];if(!job)return json({ok:false,error:'적재 작업을 찾을 수 없습니다.'},404);
  const query=new URLSearchParams({organization_id:`eq.${org}`,import_job_id:`eq.${jobId}`,select:'row_number,field_name,error_code,message,raw_row,created_at',order:'row_number.asc',limit:'10000'}),errors=(await supabase(`/rest/v1/import_errors?${query}`,{serviceRole:true})).data||[];
  return json({ok:true,jobId,errors});
}

async function reconciliationStatus(org:string){
  const query=new URLSearchParams({organization_id:`eq.${org}`,status:'in.(completed,partial)',entity_type:'in.(sales_order,inventory_snapshot)',select:'id,raw_upload_id,entity_type,status,total_rows,success_rows,error_rows,summary,completed_at,created_at',order:'created_at.desc',limit:'40'}),jobs=(await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[],latest=['sales_order','inventory_snapshot'].map(type=>jobs.find((job:any)=>job.entity_type===type)).filter(Boolean),uploadIds=latest.map((job:any)=>job.raw_upload_id).filter(Boolean),uploadQuery=uploadIds.length?`organization_id=eq.${encodeURIComponent(org)}&id=${encodeURIComponent(`in.(${uploadIds.join(',')})`)}&select=id,original_filename,storage_path,content_type`:null,uploads=uploadQuery?(await supabase(`/rest/v1/raw_uploads?${uploadQuery}`,{serviceRole:true})).data||[]:[],uploadMap=new Map(uploads.map((row:any)=>[String(row.id),row])),items=[];
  for(const job of latest){
    const upload:any=uploadMap.get(String(job.raw_upload_id));
    try{
      const source=job.summary?.sourceControl||await sourceTotalsFromUpload(job,upload),persisted=await persistedControlTotals(org,job),result=buildReconciliation(job.entity_type,source,persisted,{filename:upload?.original_filename||null,jobId:job.id});
      await update('import_jobs',{id:`eq.${job.id}`,organization_id:`eq.${org}`},{summary:{...(job.summary||{}),sourceControl:source,persistedControl:persisted,reconciliation:result}});
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

async function dataQualityStatus(org:string){
  const query=new URLSearchParams({organization_id:`eq.${org}`,status:'in.(completed,partial)',entity_type:'in.(sales_order,inventory_snapshot)',select:'id,entity_type,status,total_rows,success_rows,error_rows,summary,completed_at,created_at',order:'created_at.desc',limit:'40'}),jobs=(await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[],latest=['sales_order','inventory_snapshot'].map(type=>jobs.find((job:any)=>job.entity_type===type)).filter(Boolean),items=latest.map((job:any)=>({jobId:job.id,entityType:job.entity_type,jobStatus:job.status,filename:job.summary?.reconciliation?.filename||null,reconciliation:job.summary?.reconciliation||null,completedAt:job.completed_at||job.created_at})),summary=summarizeDataQuality(items);
  return json({ok:true,...summary,items,checkedAt:new Date().toISOString()});
}
