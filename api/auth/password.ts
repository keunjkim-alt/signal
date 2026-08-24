import {authCookies} from '../_lib/cookies.js';
import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {backendConfigured,contextForAccessToken,supabase} from '../_lib/supabase.js';

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  if(!backendConfigured())return json({ok:false,error:'Backend is not configured',code:'BACKEND_NOT_CONFIGURED'},503);
  const body=await bodyJson(request);
  const accessToken=String(body?.accessToken||'');
  const refreshToken=String(body?.refreshToken||'');
  const password=String(body?.password||'');
  if(!accessToken)return json({ok:false,error:'초대 또는 비밀번호 재설정 링크가 유효하지 않습니다.'},400);
  if(password.length<8)return json({ok:false,error:'비밀번호는 8자 이상으로 설정해주세요.'},400);
  try{
    const authUser=(await supabase('/auth/v1/user',{token:accessToken,method:'PUT',body:{password}})).data;
    await supabase(`/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(authUser.id)}&status=eq.invited`,{serviceRole:true,method:'PATCH',headers:{Prefer:'return=minimal'},body:{status:'active',updated_at:new Date().toISOString()}});
    const context=await contextForAccessToken(accessToken,null);
    const user={id:context.user.id,email:context.user.email,name:context.profile?.display_name||context.user.user_metadata?.display_name||context.user.email,role:context.membership.role,team:context.membership.team_code||'소속 미지정',scope:context.membership.data_scope,organization:context.membership.organizations,permissions:context.permissions};
    const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
    authCookies(request,accessToken,refreshToken,3600).forEach(cookie=>headers.append('set-cookie',cookie));
    return new Response(JSON.stringify({ok:true,user}),{status:200,headers});
  }catch(error:any){return errorResponse(error,error.status===400?401:error.status||500)}
}};
