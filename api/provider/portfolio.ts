import {errorResponse,json} from '../_lib/http.js';
import {applyProviderFilters,computePortfolioSummary,filterProviderScope,parseProviderFilters,providerContext,requireProviderPermission} from '../_lib/provider-admin.js';
import {supabase} from '../_lib/supabase.js';

async function rows(table:string,select:string,order?:string){const p:any={select,limit:'5000'};if(order)p.order=order;return (await supabase(`/rest/v1/${table}?${new URLSearchParams(p)}`,{serviceRole:true})).data||[]}
export default {async fetch(request:Request){try{
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);
  const context=await providerContext(request);requireProviderPermission(context,'portfolio.view');const filters=parseProviderFilters(new URL(request.url));
  const [workspaceRows,attentionRows,sourceRows]=await Promise.all([rows('workspaces','id,organization_id,brand_id,name,code,status,service_stage,timezone,updated_at','updated_at.desc'),rows('attention_items','id,organization_id,workspace_id,severity,status,category,title,assigned_team,sla_due_at,detected_at','detected_at.desc'),rows('data_sources','id,organization_id,workspace_id,brand_id,name,provider,status,sync_mode,data_mode,last_synced_at,last_successful_sync_at,last_sync_error','updated_at.desc')]);
  const workspaces=applyProviderFilters(filterProviderScope(context,workspaceRows),filters),workspaceIds=new Set(workspaces.map((x:any)=>x.id)),attention=applyProviderFilters(filterProviderScope(context,attentionRows),filters).filter((x:any)=>!x.workspace_id||workspaceIds.has(x.workspace_id)),sources=applyProviderFilters(filterProviderScope(context,sourceRows),filters).filter((x:any)=>!x.workspace_id||workspaceIds.has(x.workspace_id));
  return json({ok:true,summary:computePortfolioSummary(workspaces,attention,sources),attention:attention.slice(0,20),workspaces:workspaces.slice(0,50)});
}catch(error:any){return errorResponse(error,error.status||500)}}};
