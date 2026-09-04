import {createHash} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {cachedDashboardAggregate,dashboardScopeKey} from './dashboard-cache.js';
import {insert,supabase,update,workspaceId} from './supabase.js';

const CACHE_VERSION='dashboard-snapshot-v1';

function snapshotKey(context:any,namespace:string){
  return createHash('sha256').update(JSON.stringify({version:CACHE_VERSION,namespace,scope:dashboardScopeKey(context)})).digest('hex');
}

export function persistentDashboardCacheKey(context:any,namespace:string){return snapshotKey(context,namespace)}

async function readSnapshot<T>(context:any,namespace:string):Promise<{id:string;value:T;hitCount:number}|null>{
  const org=String(context.membership.organization_id),ws=workspaceId(context),query=new URLSearchParams({organization_id:`eq.${org}`,cache_key:`eq.${snapshotKey(context,namespace)}`,expires_at:`gt.${new Date().toISOString()}`,select:'id,result_spec,hit_count',limit:'1'});
  if(ws)query.set('workspace_id',`eq.${ws}`);else query.set('workspace_id','is.null');
  const row=((await supabase(`/rest/v1/ax_query_cache?${query}`,{serviceRole:true})).data||[])[0];
  if(!row?.result_spec||row.result_spec.cacheVersion!==CACHE_VERSION)return null;
  return {id:String(row.id),value:row.result_spec.payload as T,hitCount:Number(row.hit_count||0)};
}

function queue(task:Promise<any>){try{waitUntil(task.catch(error=>console.error('[dashboard snapshot]',error?.message||error)))}catch{void task.catch(()=>{})}}

async function writeSnapshot<T>(context:any,namespace:string,value:T,persistentTtlMs:number){
  const now=new Date(),org=String(context.membership.organization_id),ws=workspaceId(context);
  await insert('ax_query_cache',{organization_id:org,workspace_id:ws,cache_key:snapshotKey(context,namespace),page_key:`dashboard:${namespace}`,question_normalized:`dashboard:${namespace}`,filters:{},plan_spec:{cacheVersion:CACHE_VERSION,namespace,scope:dashboardScopeKey(context)},result_spec:{cacheVersion:CACHE_VERSION,payload:value},data_watermark:null,model:null,token_usage:null,expires_at:new Date(now.getTime()+Math.max(30_000,persistentTtlMs)).toISOString(),updated_at:now.toISOString()},{upsert:true,onConflict:'organization_id,cache_key'});
}

export async function cachedPersistentDashboardAggregate<T>(context:any,namespace:string,memoryTtlMs:number,persistentTtlMs:number,loader:()=>Promise<T>):Promise<T>{
  return cachedDashboardAggregate(context,namespace,memoryTtlMs,async()=>{
    const snapshot=await readSnapshot<T>(context,namespace);
    if(snapshot){queue(update('ax_query_cache',{id:`eq.${snapshot.id}`},{hit_count:snapshot.hitCount+1,updated_at:new Date().toISOString()}));return snapshot.value}
    const value=await loader();queue(writeSnapshot(context,namespace,value,persistentTtlMs));return value;
  });
}
