import {errorResponse,json} from '../_lib/http.js';
import {requestContext,supabase,workspaceId} from '../_lib/supabase.js';

export default {async fetch(request:Request){
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);
  try{
    const context=await requestContext(request,{includeProfile:false,includeBrands:false,includePermissions:false}),org=context.membership.organization_id,ws=workspaceId(context),user=context.user.id,url=new URL(request.url),conversationId=url.searchParams.get('conversationId');
    if(conversationId){const query=new URLSearchParams({organization_id:`eq.${org}`,conversation_id:`eq.${conversationId}`,select:'id,role,content,page_key,query_spec,visualization_spec,model,source,created_at',order:'created_at.asc'}),contextQuery=new URLSearchParams({organization_id:`eq.${org}`,conversation_id:`eq.${conversationId}`,user_id:`eq.${user}`,select:'context_state,context_summary,context_version,updated_at',limit:'1'});if(ws){query.set('workspace_id',`eq.${ws}`);contextQuery.set('workspace_id',`eq.${ws}`)}const [messages,contexts]=await Promise.all([supabase(`/rest/v1/ax_messages?${query}`,{token:context.accessToken}).then(result=>result.data||[]),supabase(`/rest/v1/ax_conversation_contexts?${contextQuery}`,{token:context.accessToken}).then(result=>result.data||[])]);return json({ok:true,messages,resolvedContext:contexts[0]?.context_state||null})}
    const query=new URLSearchParams({organization_id:`eq.${org}`,user_id:`eq.${user}`,status:'eq.active',select:'id,title,page_key,last_message_at,created_at',order:'last_message_at.desc',limit:'30'});if(ws)query.set('workspace_id',`eq.${ws}`);const conversations=(await supabase(`/rest/v1/ax_conversations?${query}`,{token:context.accessToken})).data||[];return json({ok:true,conversations});
  }catch(error:any){return errorResponse(error,error.status||500)}
}};
