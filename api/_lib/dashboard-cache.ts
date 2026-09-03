type CacheEntry={
  value?:unknown;
  promise?:Promise<unknown>;
  expiresAt:number;
  touchedAt:number;
};

const CACHE_SYMBOL=Symbol.for('viimsignal.dashboard.aggregate-cache');
const globalCache=globalThis as typeof globalThis&{[CACHE_SYMBOL]?:Map<string,CacheEntry>};
const cache=globalCache[CACHE_SYMBOL]||(globalCache[CACHE_SYMBOL]=new Map<string,CacheEntry>());
const MAX_ENTRIES=80;

function stable(value:any):string{
  if(value===null||typeof value!=='object'){const serialized=JSON.stringify(value);return serialized===undefined?String(value):serialized}
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function dashboardScopeKey(context:any){
  const membership=context?.membership||{};
  const permissions=(context?.permissions||[]).map((row:any)=>({page:String(row.page_key||''),view:Boolean(row.can_view),update:Boolean(row.can_update),approve:Boolean(row.can_approve)})).sort((a:any,b:any)=>a.page.localeCompare(b.page));
  return stable({
    organizationId:String(membership.organization_id||''),
    role:String(membership.role||''),
    teamCode:String(membership.team_code||''),
    dataScope:membership.data_scope||null,
    permissions
  });
}

export function dashboardCacheKey(context:any,namespace:string){
  return `${String(context?.membership?.organization_id||'unknown')}|${namespace}|${dashboardScopeKey(context)}`;
}

function prune(now:number){
  for(const [key,entry] of cache)if(!entry.promise&&entry.expiresAt<=now)cache.delete(key);
  if(cache.size<=MAX_ENTRIES)return;
  const removable=[...cache.entries()].filter(([,entry])=>!entry.promise).sort((a,b)=>a[1].touchedAt-b[1].touchedAt);
  for(const [key] of removable.slice(0,Math.max(0,cache.size-MAX_ENTRIES)))cache.delete(key);
}

export async function cachedDashboardAggregate<T>(context:any,namespace:string,ttlMs:number,loader:()=>Promise<T>,now=Date.now()):Promise<T>{
  const key=dashboardCacheKey(context,namespace),existing=cache.get(key);
  if(existing?.promise)return existing.promise as Promise<T>;
  if(existing&&existing.expiresAt>now){existing.touchedAt=now;return existing.value as T}
  const promise=loader();
  cache.set(key,{promise,expiresAt:now+Math.max(0,ttlMs),touchedAt:now});
  try{
    const value=await promise;
    cache.set(key,{value,expiresAt:Date.now()+Math.max(0,ttlMs),touchedAt:Date.now()});
    prune(Date.now());
    return value;
  }catch(error){
    if(cache.get(key)?.promise===promise)cache.delete(key);
    throw error;
  }
}

export function invalidateDashboardCache(organizationId?:string,namespaces?:string[]){
  const prefix=organizationId?`${organizationId}|`:'';
  const namespaceSet=namespaces?.length?new Set(namespaces):null;
  let removed=0;
  for(const key of cache.keys()){
    if(prefix&&!key.startsWith(prefix))continue;
    const namespace=key.split('|',3)[1];
    if(namespaceSet&&!namespaceSet.has(namespace))continue;
    cache.delete(key);removed++;
  }
  return removed;
}

export function dashboardCacheSize(){return cache.size}
