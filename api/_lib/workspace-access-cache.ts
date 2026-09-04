type WorkspaceCacheEntry={value?:any[];promise?:Promise<any[]>;expiresAt:number;touchedAt:number};

const CACHE_SYMBOL=Symbol.for('viimsignal.auth.workspace-access-cache');
const globalCache=globalThis as typeof globalThis&{[CACHE_SYMBOL]?:Map<string,WorkspaceCacheEntry>};
const cache=globalCache[CACHE_SYMBOL]||(globalCache[CACHE_SYMBOL]=new Map<string,WorkspaceCacheEntry>());
const DEFAULT_TTL_MS=20_000,MAX_ENTRIES=160;

function stableBrandScope(scope:any){return Array.isArray(scope)?scope.map(String).sort().join(','):'all'}
export function workspaceAccessCacheKey(membership:any){return [membership?.organization_id||'',membership?.id||'',membership?.role||'',stableBrandScope(membership?.data_scope?.brands)].join('|')}
function prune(now:number){
  for(const [key,entry] of cache)if(!entry.promise&&entry.expiresAt<=now)cache.delete(key);
  if(cache.size<=MAX_ENTRIES)return;
  const removable=[...cache.entries()].filter(([,entry])=>!entry.promise).sort((a,b)=>a[1].touchedAt-b[1].touchedAt);
  for(const [key] of removable.slice(0,Math.max(0,cache.size-MAX_ENTRIES)))cache.delete(key);
}
export async function cachedWorkspaceAccess(membership:any,loader:()=>Promise<any[]>,ttlMs=DEFAULT_TTL_MS,now=Date.now()){
  const key=workspaceAccessCacheKey(membership),existing=cache.get(key);
  if(existing?.promise)return existing.promise;
  if(existing&&existing.expiresAt>now){existing.touchedAt=now;return existing.value||[]}
  const promise=loader();cache.set(key,{promise,expiresAt:now+Math.max(0,ttlMs),touchedAt:now});
  try{const value=await promise,completedAt=Date.now();cache.set(key,{value,expiresAt:completedAt+Math.max(0,ttlMs),touchedAt:completedAt});prune(completedAt);return value}
  catch(error){if(cache.get(key)?.promise===promise)cache.delete(key);throw error}
}
export function invalidateWorkspaceAccessCache(organizationId?:string){let removed=0;for(const key of cache.keys()){if(organizationId&&!key.startsWith(`${organizationId}|`))continue;cache.delete(key);removed++}return removed}
export function workspaceAccessCacheSize(){return cache.size}
