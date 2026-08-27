import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {audit,requestContext,requirePagePermission,supabase,update} from '../_lib/supabase.js';
import {probeConnector,pullConnectorFile} from '../_lib/connector-runtime.js';
import uploadHandler from '../uploads/data.js';
import {connectorSystemContext} from '../_lib/connector-auth.js';

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  let source:any=null,context:any=null;
  try{
    const body=await bodyJson(request),sourceId=String(body?.sourceId||''),action=String(body?.action||'sync');context=await connectorSystemContext(request,sourceId)||await requestContext(request);requirePagePermission(context,'connections','update');
    if(!sourceId)return json({ok:false,error:'sourceId가 필요합니다.'},400);
    source=await findSource(context.membership.organization_id,sourceId);if(!source)return json({ok:false,error:'데이터 소스를 찾을 수 없습니다.'},404);
    if(source.status==='paused'||source.config?.lifecycle?.archived_at)return json({ok:false,error:'중지·보관된 연결은 동기화할 수 없습니다.'},409);
    if(!['sheet','sftp','api'].includes(source.source_type))return json({ok:false,error:'수동 동기화는 Google Sheets, WMS/SFTP, 채널 API 연결에서 지원합니다.'},422);
    if(action==='probe'){
      const probe=await probeConnector(source);await audit(context,'data_source.probed','data_source',source.id,{provider:source.provider,entityType:source.config?.entity_type,byteSize:probe.byteSize,headers:probe.headers});return json({ok:true,probe});
    }
    await update('data_sources',{id:`eq.${source.id}`,organization_id:`eq.${context.membership.organization_id}`},{last_synced_at:new Date().toISOString(),last_sync_error:null,updated_at:new Date().toISOString()});
    const file=await pullConnectorFile(source),form=new FormData();form.set('file',file);form.set('mode','import');form.set('entityType',String(source.config?.entity_type||''));form.set('sourceId',source.id);
    const headers=new Headers();const cookie=request.headers.get('cookie');if(cookie)headers.set('cookie',cookie);const authorization=request.headers.get('authorization');if(authorization)headers.set('authorization',authorization);headers.set('x-viimsignal-source-id',source.id);const requestedOrg=request.headers.get('x-fashion-ax-org');if(requestedOrg)headers.set('x-fashion-ax-org',requestedOrg);
    const response=await uploadHandler.fetch(new Request('https://internal.viimsignal/api/uploads/data',{method:'POST',headers,body:form})),payload=await response.json() as any;
    if(!response.ok)throw Object.assign(new Error(payload?.error||'수집 데이터 적재에 실패했습니다.'),{status:response.status,details:payload});
    const refreshed=await findSource(context.membership.organization_id,source.id),config={...(refreshed?.config||source.config||{}),activation:{state:'active',activated_at:new Date().toISOString(),last_filename:file.name,last_import_job_id:payload?.job?.id||null}};
    await update('data_sources',{id:`eq.${source.id}`,organization_id:`eq.${context.membership.organization_id}`},{config,status:'active',data_mode:'connected',last_sync_error:null,updated_at:new Date().toISOString()});
    await audit(context,'data_source.synced','data_source',source.id,{provider:source.provider,entityType:source.config?.entity_type,filename:file.name,duplicate:Boolean(payload?.duplicate),jobId:payload?.job?.id||null,successRows:payload?.job?.successRows||0});
    return json({ok:true,sourceId:source.id,filename:file.name,import:payload},200);
  }catch(error:any){
    if(source?.id&&context?.membership?.organization_id){try{await update('data_sources',{id:`eq.${source.id}`,organization_id:`eq.${context.membership.organization_id}`},{status:'error',data_mode:'stale',last_sync_error:String(error?.message||error),last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()});await audit(context,'data_source.sync_failed','data_source',source.id,{provider:source.provider,error:String(error?.message||error)})}catch{}}
    return errorResponse(error,error.status||500);
  }
}};

async function findSource(org:string,sourceId:string){const query=new URLSearchParams({id:`eq.${sourceId}`,organization_id:`eq.${org}`,select:'id,organization_id,brand_id,source_type,provider,name,status,data_mode,sync_mode,schedule,config,last_synced_at,last_successful_sync_at,last_sync_error',limit:'1'});return ((await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[])[0]||null}
