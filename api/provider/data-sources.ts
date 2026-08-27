import {errorResponse,json} from '../_lib/http.js';
import {applyProviderFilters,classifySourceHealth,filterProviderScope,parseProviderFilters,providerContext,requireProviderPermission} from '../_lib/provider-admin.js';
import {supabase} from '../_lib/supabase.js';

export default {async fetch(request:Request){try{
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);const context=await providerContext(request);requireProviderPermission(context,'source.view');const filters=parseProviderFilters(new URL(request.url));
  const rows=(await supabase(`/rest/v1/data_sources?${new URLSearchParams({select:'id,organization_id,workspace_id,brand_id,source_type,provider,name,status,sync_mode,schedule,data_mode,last_synced_at,last_successful_sync_at,last_sync_error,updated_at',order:'updated_at.desc',limit:'5000'})}`,{serviceRole:true})).data||[],sources=applyProviderFilters(filterProviderScope(context,rows),filters).map((source:any)=>({...source,health:classifySourceHealth(source)}));
  return json({ok:true,sources,summary:{total:sources.length,healthy:sources.filter((x:any)=>x.health==='healthy').length,error:sources.filter((x:any)=>x.health==='error').length,stale:sources.filter((x:any)=>x.health==='stale').length,paused:sources.filter((x:any)=>x.health==='paused').length}});
}catch(error:any){return errorResponse(error,error.status||500)}}};
