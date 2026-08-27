import {authCookies} from '../_lib/cookies.js';
import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {backendConfigured,membershipBrands,supabase} from '../_lib/supabase.js';

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  if(!backendConfigured())return json({ok:false,error:'Backend is not configured',code:'BACKEND_NOT_CONFIGURED'},503);
  const body=await bodyJson(request);const email=body?.email?.trim()?.toLowerCase(),password=body?.password;
  if(!email||!password)return json({ok:false,error:'Email and password are required'},400);
  try{
    const auth=(await supabase('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}})).data;
    const membershipQuery=new URLSearchParams({user_id:`eq.${auth.user.id}`,status:'in.(active,invited)',select:'id,organization_id,role,team_code,status,data_scope,organizations(id,name,slug)'});
    const memberships=(await supabase(`/rest/v1/organization_memberships?${membershipQuery}`,{serviceRole:true})).data||[];
    if(!memberships.length)return json({ok:false,error:'활성화된 회사 권한이 없습니다.'},403);
    const profileQuery=new URLSearchParams({user_id:`eq.${auth.user.id}`,select:'display_name,avatar_url,locale'});
    const profile=((await supabase(`/rest/v1/profiles?${profileQuery}`,{serviceRole:true})).data||[])[0]||{};
    const membership=memberships[0];if(membership.status==='invited')await supabase(`/rest/v1/organization_memberships?id=eq.${membership.id}`,{serviceRole:true,method:'PATCH',headers:{Prefer:'return=minimal'},body:{status:'active',updated_at:new Date().toISOString()}});const permissionQuery=new URLSearchParams({membership_id:`eq.${membership.id}`,select:'page_key,can_view,can_update,can_approve,data_scope'});const permissions=(await supabase(`/rest/v1/page_permissions?${permissionQuery}`,{serviceRole:true})).data||[],brands=await membershipBrands(membership);const user={id:auth.user.id,email:auth.user.email,name:profile.display_name||auth.user.user_metadata?.display_name||auth.user.email,role:membership.role,team:membership.team_code||'소속 미지정',scope:membership.data_scope,organization:membership.organizations,permissions,brands};
    const responseHeaders=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});authCookies(request,auth.access_token,auth.refresh_token,auth.expires_in).forEach(cookie=>responseHeaders.append('set-cookie',cookie));
    return new Response(JSON.stringify({ok:true,user}),{status:200,headers:responseHeaders});
  }catch(error:any){return errorResponse(error,error.status===400?401:error.status||500)}
}};
