import {bodyJson,errorResponse,json} from '../http.js';
import {requireTaskTransition} from '../operational-workflow.js';
import {filterProviderScope,inProviderScope,providerAudit,providerContext,requireProviderPermission} from '../provider-admin.js';
import {supabase,update} from '../supabase.js';

async function rows(params:Record<string,string>){return (await supabase(`/rest/v1/operational_tasks?${new URLSearchParams(params)}`,{serviceRole:true})).data||[]}
export default {async fetch(request:Request){try{
  const context=await providerContext(request);requireProviderPermission(context,request.method==='GET'?'portfolio.view':'attention.manage');const url=new URL(request.url);
  if(request.method==='GET'){const params:any={select:'*',order:'created_at.desc',limit:String(Math.min(200,Math.max(1,Number(url.searchParams.get('limit'))||50)))};if(url.searchParams.get('status'))params.status=`eq.${url.searchParams.get('status')}`;return json({ok:true,tasks:filterProviderScope(context,await rows(params))})}
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);const body:any=await bodyJson(request);if(!body?.id)return json({ok:false,error:'id is required'},400);const task=(await rows({id:`eq.${body.id}`,select:'*',limit:'1'}))[0];if(!task)return json({ok:false,error:'Task not found'},404);if(!inProviderScope(context,task))return json({ok:false,error:'Task is outside the provider scope'},403);const values:any={updated_at:new Date().toISOString()};
  if(body.action==='assign'){values.assigned_team=body.assigned_team||task.assigned_team;values.assigned_user_id=body.assigned_user_id||null}
  else if(body.action==='transition'){requireTaskTransition(task.status,body.status);values.status=body.status;if(body.status==='completed'){if(!String(body.resolution_note||'').trim())return json({ok:false,error:'resolution_note is required'},400);values.completed_at=new Date().toISOString();values.completed_by=context.user.id;values.resolution_note=body.resolution_note}}
  else return json({ok:false,error:'Unsupported task action'},400);const result=(await update('operational_tasks',{id:`eq.${task.id}`},values))?.[0];await providerAudit(context,`task.${body.action}`,'operational_task',task.id,{organization_id:task.organization_id,workspace_id:task.workspace_id,reason:body.reason||body.resolution_note||null,from_status:task.status,to_status:result.status});return json({ok:true,task:result});
}catch(error:any){return errorResponse(error,error.status||500)}}};
