import {authCookies,clearAuthCookies,readCookies} from './_lib/cookies.js';
import {bodyJson,errorResponse,json} from './_lib/http.js';
import {audit,backendConfigured,contextForAccessToken,insert,membershipBrands,membershipWorkspaces,requestContext,requireRole,supabase,update} from './_lib/supabase.js';
import {invalidateRequestContextCache} from './_lib/request-context-cache.js';
import {workspaceInsertPayload,workspaceUpdatePayload} from './_lib/workspaces.js';

async function sessionPayload(context:any){return {ok:true,authenticated:true,backendConfigured:true,user:{id:context.user.id,email:context.user.email,name:context.profile?.display_name||context.user.email,role:context.membership.role,team:context.membership.team_code||'소속 미지정',scope:context.membership.data_scope,organization:context.membership.organizations,permissions:context.permissions,brands:context.brands||[],workspaces:await membershipWorkspaces(context.membership)}}}

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
    const membership=memberships[0],profileQuery=new URLSearchParams({user_id:`eq.${auth.user.id}`,select:'display_name,avatar_url,locale'}),permissionQuery=new URLSearchParams({membership_id:`eq.${membership.id}`,select:'page_key,can_view,can_update,can_approve,data_scope'});
    const [profiles,permissions,brands]=await Promise.all([
      supabase(`/rest/v1/profiles?${profileQuery}`,{serviceRole:true}).then(result=>result.data||[]),
      supabase(`/rest/v1/page_permissions?${permissionQuery}`,{serviceRole:true}).then(result=>result.data||[]),
      membershipBrands(membership),
      membership.status==='invited'?supabase(`/rest/v1/organization_memberships?id=eq.${membership.id}`,{serviceRole:true,method:'PATCH',headers:{Prefer:'return=minimal'},body:{status:'active',updated_at:new Date().toISOString()}}):Promise.resolve(null)
    ]),profile=profiles[0]||{},user={id:auth.user.id,email:auth.user.email,name:profile.display_name||auth.user.user_metadata?.display_name||auth.user.email,role:membership.role,team:membership.team_code||'소속 미지정',scope:membership.data_scope,organization:membership.organizations,permissions,brands};
    const responseHeaders=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});authCookies(request,auth.access_token,auth.refresh_token,auth.expires_in).forEach(cookie=>responseHeaders.append('set-cookie',cookie));
    return new Response(JSON.stringify({ok:true,user:{...user,workspaces:await membershipWorkspaces(membership)}}),{status:200,headers:responseHeaders});
  }catch(error:any){return errorResponse(error,error.status===400?401:error.status||500)}
}

async function logout(request:Request){const accessToken=readCookies(request).fashion_ax_access;if(accessToken)invalidateRequestContextCache({accessToken});const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});clearAuthCookies(request).forEach(cookie=>headers.append('set-cookie',cookie));return new Response(JSON.stringify({ok:true}),{status:200,headers})}

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
  try{const context=await requestContext(request);return json(await sessionPayload(context))}catch(error:any){
    if(error.status!==401)return errorResponse(error,error.status||500);const refreshToken=readCookies(request).fashion_ax_refresh;if(!refreshToken)return json({ok:true,authenticated:false,backendConfigured:true},200);
    try{const auth=(await supabase('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken}})).data;const context=await contextForAccessToken(auth.access_token,request.headers.get('x-fashion-ax-org'));const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store'});authCookies(request,auth.access_token,auth.refresh_token,auth.expires_in).forEach(cookie=>headers.append('set-cookie',cookie));return new Response(JSON.stringify(await sessionPayload(context)),{status:200,headers});}catch{return json({ok:true,authenticated:false,backendConfigured:true},200)}
  }
}

async function workspaces(request:Request){
  const context=await requestContext(request);
  if(request.method==='GET')return json({ok:true,workspaces:await membershipWorkspaces(context.membership)});
  requireRole(context,['owner','admin']);
  if(request.method==='POST'){
    const body=await bodyJson(request),payload=workspaceInsertPayload(context.membership.organization_id,body);
    if(payload.brand_id){const brands=await membershipBrands(context.membership);if(!brands.some((brand:any)=>String(brand.id)===String(payload.brand_id)))return json({ok:false,error:'선택한 브랜드를 사용할 수 없습니다.'},403)}
    try{const workspace=(await insert('workspaces',payload))?.[0];await insert('workspace_memberships',{organization_id:context.membership.organization_id,workspace_id:workspace.id,membership_id:context.membership.id,role:'admin',status:'active'},{upsert:true,onConflict:'workspace_id,membership_id'});await audit(context,'workspace.created','workspace',workspace.id,{workspace_code:workspace.code,test_data:Boolean(workspace.metadata?.test_data)});return json({ok:true,workspace},201)}catch(error:any){if(error.status===409||String(error.message).includes('duplicate'))return json({ok:false,error:'이미 사용 중인 워크스페이스 코드입니다.'},409);throw error}
  }
  if(request.method==='PATCH'){
    const contentType=request.headers.get('content-type')||'',form=contentType.includes('multipart/form-data')?await request.formData():null,body=form?JSON.parse(String(form.get('payload')||'{}')):await bodyJson(request),workspaceId=String(body.workspaceId||context.workspace?.id||''),available=await membershipWorkspaces(context.membership),current=available.find((row:any)=>String(row.id)===workspaceId);
    if(!current)return json({ok:false,error:'워크스페이스를 찾을 수 없습니다.'},404);
    const values:any=workspaceUpdatePayload(body,current);
    if(values.brand_id){const brands=await membershipBrands(context.membership);if(!brands.some((brand:any)=>String(brand.id)===String(values.brand_id)))return json({ok:false,error:'선택한 브랜드를 사용할 수 없습니다.'},403)}
    const image=form?.get('image');
    if(image instanceof File&&image.size){
      if(!image.type.startsWith('image/')||image.size>2*1024*1024)return json({ok:false,error:'이미지는 PNG, JPG, WebP 형식으로 2MB 이하만 가능합니다.'},422);
      const ext=image.type==='image/png'?'png':image.type==='image/webp'?'webp':'jpg',path=`${context.membership.organization_id}/${workspaceId}/avatar-${Date.now()}.${ext}`;
      await supabase(`/storage/v1/object/workspace-assets/${path}`,{serviceRole:true,method:'POST',headers:{'content-type':image.type,'x-upsert':'true'},body:await image.arrayBuffer()});
      values.image_url=`${process.env.SUPABASE_URL}/storage/v1/object/public/workspace-assets/${path}`;
    }
    try{const workspace=(await update('workspaces',{id:`eq.${workspaceId}`,organization_id:`eq.${context.membership.organization_id}`},values))?.[0];await audit({...context,workspace:current},'workspace.updated','workspace',workspaceId,{fields:Object.keys(values).filter(key=>key!=='updated_at'),image_updated:Boolean(image instanceof File&&image.size)});return json({ok:true,workspace})}catch(error:any){if(error.status===409||String(error.message).includes('duplicate'))return json({ok:false,error:'이미 사용 중인 워크스페이스 코드입니다.'},409);throw error}
  }
  return json({ok:false,error:'Method not allowed'},405);
}

export default {async fetch(request:Request){try{const action=new URL(request.url).searchParams.get('action');if(action==='login')return await login(request);if(action==='logout')return await logout(request);if(action==='password')return await password(request);if(action==='session')return await session(request);if(action==='workspaces')return await workspaces(request);return json({ok:false,error:'Unknown auth action'},404)}catch(error:any){return errorResponse(error,error.status||500)}}};
