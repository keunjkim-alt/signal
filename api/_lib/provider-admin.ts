import {readCookies} from './cookies.js';
import {authUser,insert,supabase} from './supabase.js';

export const providerRoles=['service_ops','data_ops','product_ops','customer_success','account_manager','sre','auditor','super_admin'] as const;
export type ProviderRole=(typeof providerRoles)[number];
export type ProviderAction='portfolio.view'|'organization.view'|'source.view'|'attention.manage'|'assignment.manage'|'audit.view';

const permissions:Record<ProviderRole,ProviderAction[]>={
  service_ops:['portfolio.view','organization.view','source.view','attention.manage','audit.view'],
  data_ops:['portfolio.view','organization.view','source.view','attention.manage','audit.view'],
  product_ops:['portfolio.view','organization.view','source.view','attention.manage','audit.view'],
  customer_success:['portfolio.view','organization.view','source.view','attention.manage'],
  account_manager:['portfolio.view','organization.view','source.view'],
  sre:['portfolio.view','organization.view','source.view','attention.manage','audit.view'],
  auditor:['portfolio.view','organization.view','source.view','audit.view'],
  super_admin:['portfolio.view','organization.view','source.view','attention.manage','assignment.manage','audit.view']
};

export function providerCan(role:ProviderRole,action:ProviderAction){return permissions[role]?.includes(action)||false}
export function requireProviderPermission(context:any,action:ProviderAction){if(!providerCan(context.provider.role,action)){const error:any=new Error(`Provider permission required: ${action}`);error.status=403;throw error}}

export async function providerContext(request:Request){
  const accessToken=readCookies(request).fashion_ax_access;
  if(!accessToken){const error:any=new Error('Authentication required');error.status=401;throw error}
  const user=await authUser(accessToken),query=new URLSearchParams({user_id:`eq.${user.id}`,status:'eq.active',select:'id,user_id,role,status'}),provider=((await supabase(`/rest/v1/provider_memberships?${query}`,{serviceRole:true})).data||[])[0];
  if(!provider){const error:any=new Error('Active provider membership required');error.status=403;throw error}
  const assignments=(await supabase(`/rest/v1/provider_assignments?${new URLSearchParams({provider_membership_id:`eq.${provider.id}`,select:'organization_id,workspace_id'})}`,{serviceRole:true})).data||[];
  return {user,provider,assignments,accessToken};
}

export function scopeSets(context:any){
  if(context.provider.role==='super_admin')return {all:true,organizationIds:new Set<string>(),workspaceIds:new Set<string>()};
  return {all:false,organizationIds:new Set<string>(context.assignments.map((x:any)=>x.organization_id).filter(Boolean)),workspaceIds:new Set<string>(context.assignments.map((x:any)=>x.workspace_id).filter(Boolean))};
}
export function inProviderScope(context:any,row:any){const s=scopeSets(context);return s.all||s.organizationIds.has(row.organization_id)||s.workspaceIds.has(row.workspace_id)}
export function filterProviderScope(context:any,rows:any[]){return rows.filter(row=>inProviderScope(context,row))}

export function parseProviderFilters(url:URL){return {organizationId:url.searchParams.get('organization_id'),workspaceId:url.searchParams.get('workspace_id'),status:url.searchParams.get('status'),search:(url.searchParams.get('q')||'').trim().toLowerCase()}}
export function applyProviderFilters(rows:any[],filters:ReturnType<typeof parseProviderFilters>){return rows.filter(row=>(!filters.organizationId||row.organization_id===filters.organizationId)&&(!filters.workspaceId||row.workspace_id===filters.workspaceId)&&(!filters.status||row.status===filters.status)&&(!filters.search||JSON.stringify([row.name,row.code,row.provider,row.title]).toLowerCase().includes(filters.search)))}

export function classifySourceHealth(source:any,now=new Date()){
  if(source.status==='error'||source.last_sync_error)return 'error';
  if(source.status==='paused')return 'paused';
  const last=source.last_successful_sync_at||source.last_synced_at;if(!last)return source.status==='draft'?'setup':'stale';
  const hours=(now.getTime()-new Date(last).getTime())/36e5,threshold=source.sync_mode==='realtime'?2:source.sync_mode==='scheduled'?30:168;
  return hours>threshold?'stale':'healthy';
}

export function computePortfolioSummary(workspaces:any[],attention:any[],sources:any[]){
  const open=attention.filter(x=>!['resolved','dismissed'].includes(x.status)),sourceHealth=sources.map(x=>classifySourceHealth(x));
  return {organizations:new Set(workspaces.map(x=>x.organization_id)).size,workspaces:workspaces.length,activeWorkspaces:workspaces.filter(x=>x.status==='active').length,openAttention:open.length,criticalAttention:open.filter(x=>x.severity==='critical').length,overdueAttention:open.filter(x=>x.sla_due_at&&new Date(x.sla_due_at)<new Date()).length,sources:sources.length,healthySources:sourceHealth.filter(x=>x==='healthy').length,unhealthySources:sourceHealth.filter(x=>['error','stale'].includes(x)).length};
}

export async function providerAudit(context:any,action:string,resourceType:string,resourceId?:string,metadata:any={}){return insert('audit_logs',{organization_id:metadata.organization_id||null,workspace_id:metadata.workspace_id||null,actor_user_id:context.user.id,action,resource_type:resourceType,resource_id:resourceId||null,trace_id:metadata.trace_id||null,reason:metadata.reason||null,metadata:{...metadata,provider_membership_id:context.provider.id}})}
