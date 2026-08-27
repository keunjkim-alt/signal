import {json} from '../_lib/http.js';
import {isConnectorSystemRequest} from '../_lib/connector-auth.js';
import {sourceSyncDue} from '../_lib/sync-schedule.js';
import {supabase} from '../_lib/supabase.js';
import syncHandler from './sync.js';

export default {async fetch(request:Request){
  if(request.method!=='GET'&&request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  if(!isConnectorSystemRequest(request))return json({ok:false,error:'Unauthorized'},401);
  const query=new URLSearchParams({sync_mode:'eq.scheduled',status:'in.(draft,active,error)',source_type:'in.(sheet,sftp,api)',select:'id,name,source_type,provider,status,sync_mode,schedule,config,last_synced_at',order:'last_synced_at.asc.nullsfirst',limit:'20'}),sources=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[],due=sources.filter((source:any)=>sourceSyncDue(source)).slice(0,5),results:any[]=[];
  for(const source of due){
    const response=await syncHandler.fetch(new Request('https://internal.viimsignal/api/integrations/sync',{method:'POST',headers:{authorization:request.headers.get('authorization')||'','content-type':'application/json'},body:JSON.stringify({sourceId:source.id,action:'sync'})})),payload=await response.json() as any;
    results.push({sourceId:source.id,name:source.name,status:response.ok?'completed':'failed',jobId:payload?.import?.job?.id||null,error:response.ok?null:payload?.error||'동기화 실패'});
  }
  return json({ok:true,checked:sources.length,due:due.length,completed:results.filter(item=>item.status==='completed').length,failed:results.filter(item=>item.status==='failed').length,results,checkedAt:new Date().toISOString()});
}};
