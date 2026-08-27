import {authCookies,clearAuthCookies,readCookies} from './_lib/cookies.js';
import {bodyJson,errorResponse,json} from './_lib/http.js';
import {backendConfigured,contextForAccessToken,membershipBrands,requestContext,supabase} from './_lib/supabase.js';

function sessionPayload(context:any){return {ok:true,authenticated:true,backendConfigured:true,user:{id:context.user.id,email:context.user.email,name:context.profile?.display_name||context.user.email,role:context.membership.role,team:context.membership.team_code||'소속 미지정',scope:context.membership.data_scope,organization:context.membership.organizations,permissions:context.permissions,brands:context.brands||[]}}}

async function login(request:Request){
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
}

async function logout(request:Request){const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});clearAuthCookies(request).forEach(cookie=>headers.append('set-cookie',cookie));return new Response(JSON.stringify({ok:true}),{status:200,headers})}

async function password(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  if(!backendConfigured())return json({ok:false,error:'Backend is not configured',code:'BACKEND_NOT_CONFIGURED'},503);
  const body=await bodyJson(request);const accessToken=String(body?.accessToken||''),refreshToken=String(body?.refreshToken||''),nextPassword=String(body?.password||'');
  if(!accessToken)return json({ok:false,error:'초대 또는 비밀번호 재설정 링크가 유효하지 않습니다.'},400);
  if(nextPassword.length<8)return json({ok:false,error:'비밀번호는 8자 이상으로 설정해주세요.'},400);
  try{
    const authUser=(await supabase('/auth/v1/user',{token:accessToken,method:'PUT',body:{password:nextPassword}})).data;
    await supabase(`/rest/v1/organization_memberships?user_id=eq.${encodeURIComponent(authUser.id)}&status=eq.invited`,{serviceRole:true,method:'PATCH',headers:{Prefer:'return=minimal'},body:{status:'active',updated_at:new Date().toISOString()}});
    const context=await contextForAccessToken(accessToken,null);const user={id:context.user.id,email:context.user.email,name:context.profile?.display_name||context.user.user_metadata?.display_name||context.user.email,role:context.membership.role,team:context.membership.team_code||'소속 미지정',scope:context.membership.data_scope,organization:context.membership.organizations,permissions:context.permissions};
    const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});authCookies(request,accessToken,refreshToken,3600).forEach(cookie=>headers.append('set-cookie',cookie));return new Response(JSON.stringify({ok:true,user}),{status:200,headers});
  }catch(error:any){return errorResponse(error,error.status===400?401:error.status||500)}
}

async function session(request:Request){
  if(!backendConfigured())return json({ok:false,authenticated:false,backendConfigured:false},503);
  try{const context=await requestContext(request);return json(sessionPayload(context))}catch(error:any){
    if(error.status!==401)return errorResponse(error,error.status||500);const refreshToken=readCookies(request).fashion_ax_refresh;if(!refreshToken)return json({ok:true,authenticated:false,backendConfigured:true},200);
    try{const auth=(await supabase('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken}})).data;const context=await contextForAccessToken(auth.access_token,request.headers.get('x-fashion-ax-org'));const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});authCookies(request,auth.access_token,auth.refresh_token,auth.expires_in).forEach(cookie=>headers.append('set-cookie',cookie));return new Response(JSON.stringify(sessionPayload(context)),{status:200,headers});}catch{return json({ok:true,authenticated:false,backendConfigured:true},200)}
  }
}

export default {async fetch(request:Request){const action=new URL(request.url).searchParams.get('action');if(action==='login')return login(request);if(action==='logout')return logout(request);if(action==='password')return password(request);if(action==='session')return session(request);return json({ok:false,error:'Unknown auth action'},404)}};
