import {authCookies,readCookies} from '../_lib/cookies.js';
import {errorResponse,json} from '../_lib/http.js';
import {backendConfigured,contextForAccessToken,requestContext,supabase} from '../_lib/supabase.js';

function sessionPayload(context:any){return {ok:true,authenticated:true,backendConfigured:true,user:{id:context.user.id,email:context.user.email,name:context.profile?.display_name||context.user.email,role:context.membership.role,team:context.membership.team_code||'소속 미지정',scope:context.membership.data_scope,organization:context.membership.organizations,permissions:context.permissions}}}

export default {async fetch(request:Request){
  if(!backendConfigured())return json({ok:false,authenticated:false,backendConfigured:false},503);
  try{const context=await requestContext(request);return json(sessionPayload(context))}catch(error:any){
    if(error.status!==401)return errorResponse(error,error.status||500);
    const refreshToken=readCookies(request).fashion_ax_refresh;
    if(!refreshToken)return json({ok:true,authenticated:false,backendConfigured:true},200);
    try{
      const auth=(await supabase('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken}})).data;
      const context=await contextForAccessToken(auth.access_token,request.headers.get('x-fashion-ax-org'));
      const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      authCookies(request,auth.access_token,auth.refresh_token,auth.expires_in).forEach(cookie=>headers.append('set-cookie',cookie));
      return new Response(JSON.stringify(sessionPayload(context)),{status:200,headers});
    }catch{return json({ok:true,authenticated:false,backendConfigured:true},200)}
  }
}};
