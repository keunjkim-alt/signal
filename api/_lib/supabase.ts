import {readCookies} from './cookies.js';
import {cachedRequestContext} from './request-context-cache.js';

const url=()=>process.env.SUPABASE_URL?.replace(/\/$/,'');
const anonKey=()=>process.env.SUPABASE_ANON_KEY;
const serviceKey=()=>process.env.SUPABASE_SERVICE_ROLE_KEY;

export function backendConfigured(){return Boolean(url()&&anonKey()&&serviceKey())}

export async function supabase(path:string,options:any={}){
  if(!url())throw new Error('SUPABASE_URL is not configured');
  const key=options.serviceRole?serviceKey():anonKey();
  if(!key)throw new Error(options.serviceRole?'SUPABASE_SERVICE_ROLE_KEY is not configured':'SUPABASE_ANON_KEY is not configured');
  const headers:any={apikey:key,authorization:`Bearer ${options.token||key}`,...options.headers};
  if(options.body!==undefined&&!headers['content-type'])headers['content-type']='application/json';
  const response=await fetch(`${url()}${path}`,{method:options.method||'GET',headers,body:options.body===undefined?undefined:headers['content-type']==='application/json'?JSON.stringify(options.body):options.body});
  const text=await response.text();
  let data:any=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok){const message=data?.msg||data?.message||data?.error_description||data?.error||`Supabase ${response.status}`;const error:any=new Error(message);error.status=response.status;error.details=data;throw error}
  return {data,response};
}

export async function downloadStorageObject(bucket:string,path:string){
  if(!url())throw new Error('SUPABASE_URL is not configured');
  const key=serviceKey();if(!key)throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  const encodedPath=String(path).split('/').map(part=>encodeURIComponent(part)).join('/'),response=await fetch(`${url()}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,{headers:{apikey:key,authorization:`Bearer ${key}`}});
  if(!response.ok){let message=`Supabase Storage ${response.status}`;try{const data=await response.json();message=data?.message||data?.error||message}catch{}const error:any=new Error(message);error.status=response.status;throw error}
  return response.arrayBuffer();
}

export async function authUser(accessToken:string){
  return (await supabase('/auth/v1/user',{token:accessToken})).data;
}

export async function membershipBrands(membership:any){
  const query=new URLSearchParams({organization_id:`eq.${membership.organization_id}`,status:'eq.active',select:'id,name,code,country_code,status',order:'name.asc'});
  const brands=(await supabase(`/rest/v1/brands?${query}`,{serviceRole:true,headers:{accept:'application/json'}})).data||[];
  const scope=membership.data_scope?.brands;
  if(!Array.isArray(scope))return brands;
  const allowed=new Set(scope.map((value:any)=>String(value).toLowerCase()));
  return brands.filter((brand:any)=>allowed.has(String(brand.id).toLowerCase())||allowed.has(String(brand.code).toLowerCase()));
}

export async function membershipWorkspaces(membership:any){const query=new URLSearchParams({organization_id:`eq.${membership.organization_id}`,status:'in.(onboarding,active,paused)',select:'id,brand_id,name,code,description,image_url,status,service_stage,timezone,data_region,metadata',order:'created_at.asc'}),workspaces=(await supabase(`/rest/v1/workspaces?${query}`,{serviceRole:true})).data||[];let accessible=workspaces;if(!['owner','admin'].includes(membership.role)){const accessQuery=new URLSearchParams({membership_id:`eq.${membership.id}`,status:'eq.active',select:'workspace_id,role'}),access=(await supabase(`/rest/v1/workspace_memberships?${accessQuery}`,{serviceRole:true})).data||[],byId=new Map(access.map((row:any)=>[String(row.workspace_id),row.role||null]));accessible=workspaces.filter((workspace:any)=>byId.has(String(workspace.id))).map((workspace:any)=>({...workspace,workspace_role:byId.get(String(workspace.id))}))}const brandScope=membership.data_scope?.brands;if(!Array.isArray(brandScope))return accessible;const allowed=new Set(brandScope.map((value:any)=>String(value).toLowerCase()));return accessible.filter((workspace:any)=>!workspace.brand_id||allowed.has(String(workspace.brand_id).toLowerCase()))}

type ContextOptions={includeProfile?:boolean;includeBrands?:boolean;includePermissions?:boolean;permissionPage?:string};

export async function contextForAccessToken(accessToken:string,requestedOrganization?:string|null,options:ContextOptions={}){
  return cachedRequestContext(accessToken,requestedOrganization,options,async()=>{
    const user=await authUser(accessToken);
    const query=new URLSearchParams({user_id:`eq.${user.id}`,status:'eq.active',select:'id,organization_id,role,team_code,data_scope,organizations(id,name,slug)'});
    const memberships=(await supabase(`/rest/v1/organization_memberships?${query}`,{serviceRole:true,headers:{accept:'application/json'}})).data||[];
    if(!memberships.length){const error:any=new Error('No active organization membership');error.status=403;throw error}
    const membership=memberships.find((item:any)=>item.organization_id===requestedOrganization)||memberships[0];
    const profileQuery=new URLSearchParams({user_id:`eq.${user.id}`,select:'display_name,avatar_url,locale'}),permissionQuery=new URLSearchParams({membership_id:`eq.${membership.id}`,select:'page_key,can_view,can_update,can_approve,data_scope'});
    if(options.permissionPage)permissionQuery.set('page_key',`eq.${options.permissionPage}`);
    const needsPermissions=options.includePermissions!==false&&(!options.permissionPage||!['owner','admin'].includes(membership.role));
    const [profiles,permissions,brands]=await Promise.all([
      options.includeProfile===false?Promise.resolve([]):supabase(`/rest/v1/profiles?${profileQuery}`,{serviceRole:true}).then(result=>result.data||[]),
      needsPermissions?supabase(`/rest/v1/page_permissions?${permissionQuery}`,{serviceRole:true}).then(result=>result.data||[]):Promise.resolve([]),
      options.includeBrands===false?Promise.resolve([]):membershipBrands(membership)
    ]);
    return {user,membership,profile:profiles[0]||null,permissions,brands,accessToken};
  });
}

export async function requestContext(request:Request,options:ContextOptions={}){
  if(!backendConfigured()){const error:any=new Error('Backend is not configured');error.status=503;throw error}
  const cookies=readCookies(request);
  const accessToken=cookies.fashion_ax_access;
  if(!accessToken){const error:any=new Error('Authentication required');error.status=401;throw error}
  const context:any=await contextForAccessToken(accessToken,request.headers.get('x-fashion-ax-org'),options);
  const requestedWorkspace=request.headers.get('x-viimsignal-workspace-id');
  if(requestedWorkspace){
    const workspaces=await membershipWorkspaces(context.membership),workspace=workspaces.find((row:any)=>String(row.id)===requestedWorkspace);
    if(!workspace){const error:any=new Error('Workspace is outside the account scope');error.status=403;throw error}
    if(['paused','offboarded'].includes(workspace.status)){const error:any=new Error('Workspace is not active');error.status=409;throw error}
    context.workspace=workspace;
  }
  return context;
}

export function workspaceId(context:any){return context?.workspace?.id||null}
export function workspaceFilter(context:any){const id=workspaceId(context);return id?`eq.${id}`:'is.null'}

export function requireRole(context:any,roles:string[]){
  if(!roles.includes(context.membership.role)){const error:any=new Error('Insufficient permission');error.status=403;throw error}
}

export function requirePagePermission(context:any,pageKey:string,action:'view'|'update'|'approve'='view'){
  if(['owner','admin'].includes(context.membership.role))return;
  const permission=context.permissions.find((item:any)=>item.page_key===pageKey);
  const field=action==='view'?'can_view':action==='update'?'can_update':'can_approve';
  if(!permission?.[field]){const error:any=new Error(`Page permission required: ${pageKey}.${action}`);error.status=403;throw error}
}

export function scopedValues(context:any,key:'countries'|'channels'|'locations',requested?:string|null){
  if(['owner','admin'].includes(context.membership.role))return requested?[requested]:null;
  const scope=context.membership.data_scope?.[key];
  if(!scope||scope==='all')return requested?[requested]:null;
  const allowed=Array.isArray(scope)?scope.map(String):[];
  if(requested&&!allowed.includes(requested)){const error:any=new Error(`Requested ${key} filter is outside the account data scope`);error.status=403;throw error}
  return requested?[requested]:allowed;
}

export async function insert(table:string,rows:any,options:any={}){
  const prefer=options.upsert?'resolution=merge-duplicates,return=representation':'return=representation';
  return (await supabase(`/rest/v1/${table}${options.onConflict?`?on_conflict=${encodeURIComponent(options.onConflict)}`:''}`,{serviceRole:true,method:'POST',headers:{Prefer:prefer},body:rows})).data;
}

export async function update(table:string,filters:Record<string,string>,values:any){
  const query=new URLSearchParams(filters).toString();
  return (await supabase(`/rest/v1/${table}?${query}`,{serviceRole:true,method:'PATCH',headers:{Prefer:'return=representation'},body:values})).data;
}

export async function audit(context:any,action:string,resourceType:string,resourceId?:string,metadata:any={}){
  return insert('audit_logs',{organization_id:context.membership.organization_id,workspace_id:workspaceId(context),actor_user_id:context.user.id,action,resource_type:resourceType,resource_id:resourceId||null,metadata});
}
