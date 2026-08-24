import {errorResponse,json} from '../_lib/http.js';
import {requestContext,supabase} from '../_lib/supabase.js';

export default {async fetch(request:Request){
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);
  try{
    const context=await requestContext(request),org=context.membership.organization_id,user=context.user.id,url=new URL(request.url),conversationId=url.searchParams.get('conversationId');
    if(conversationId){const query=new URLSearchParams({organization_id:`eq.${org}`,conversation_id:`eq.${conversationId}`,select:'id,role,content,page_key,query_spec,visualization_spec,model,source,created_at',order:'created_at.asc'});const messages=(await supabase(`/rest/v1/ax_messages?${query}`,{token:context.accessToken})).data||[];return json({ok:true,messages})}
    const query=new URLSearchParams({organization_id:`eq.${org}`,user_id:`eq.${user}`,status:'eq.active',select:'id,title,page_key,last_message_at,created_at',order:'last_message_at.desc',limit:'30'});const conversations=(await supabase(`/rest/v1/ax_conversations?${query}`,{token:context.accessToken})).data||[];return json({ok:true,conversations});
  }catch(error:any){return errorResponse(error,error.status||500)}
}};
