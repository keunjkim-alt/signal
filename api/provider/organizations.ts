import {errorResponse,json} from '../_lib/http.js';
import {applyProviderFilters,filterProviderScope,parseProviderFilters,providerContext,requireProviderPermission} from '../_lib/provider-admin.js';
import {supabase} from '../_lib/supabase.js';

export default {async fetch(request:Request){try{
  if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);const context=await providerContext(request);requireProviderPermission(context,'organization.view');const filters=parseProviderFilters(new URL(request.url));
  const workspaces=(await supabase(`/rest/v1/workspaces?${new URLSearchParams({select:'id,organization_id,brand_id,name,code,status,service_stage,timezone,data_region,metadata,created_at,updated_at',order:'name.asc',limit:'5000'})}`,{serviceRole:true})).data||[],scoped=applyProviderFilters(filterProviderScope(context,workspaces),filters),orgIds=[...new Set(scoped.map((x:any)=>x.organization_id))],organizations=orgIds.length?(await supabase(`/rest/v1/organizations?${new URLSearchParams({id:`in.(${orgIds.join(',')})`,select:'id,name,slug,status,timezone,created_at,updated_at',order:'name.asc'})}`,{serviceRole:true})).data||[]:[];
  return json({ok:true,organizations:organizations.map((org:any)=>({...org,workspaces:scoped.filter((w:any)=>w.organization_id===org.id)})),totalOrganizations:organizations.length,totalWorkspaces:scoped.length});
}catch(error:any){return errorResponse(error,error.status||500)}}};
