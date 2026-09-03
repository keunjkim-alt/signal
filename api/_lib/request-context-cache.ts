import {createHash} from 'node:crypto';

type ContextCacheOptions={includeProfile?:boolean;includeBrands?:boolean;includePermissions?:boolean;permissionPage?:string};
type CacheEntry={value?:any;promise?:Promise<any>;expiresAt:number;touchedAt:number;tokenHash:string};

const CACHE_SYMBOL=Symbol.for('viimsignal.auth.request-context-cache');
const globalCache=globalThis as typeof globalThis&{[CACHE_SYMBOL]?:Map<string,CacheEntry>};
const cache=globalCache[CACHE_SYMBOL]||(globalCache[CACHE_SYMBOL]=new Map<string,CacheEntry>());
const DEFAULT_TTL_MS=15_000,MAX_ENTRIES=120;

function hashToken(accessToken:string){return createHash('sha256').update(accessToken).digest('hex')}
function optionKey(options:ContextCacheOptions={}){
  return [options.includeProfile===false?'p0':'p1',options.includeBrands===false?'b0':'b1',options.includePermissions===false?'r0':'r1',`page:${options.permissionPage||'*'}`].join('|');
}
export function requestContextCacheKey(accessToken:string,requestedOrganization?:string|null,options:ContextCacheOptions={}){
  return `${hashToken(accessToken).slice(0,24)}|org:${requestedOrganization||'default'}|${optionKey(options)}`;
}
function prune(now:number){
  for(const [key,entry] of cache)if(!entry.promise&&entry.expiresAt<=now)cache.delete(key);
  if(cache.size<=MAX_ENTRIES)return;
  const removable=[...cache.entries()].filter(([,entry])=>!entry.promise).sort((a,b)=>a[1].touchedAt-b[1].touchedAt);
  for(const [key] of removable.slice(0,Math.max(0,cache.size-MAX_ENTRIES)))cache.delete(key);
}
export async function cachedRequestContext<T>(accessToken:string,requestedOrganization:string|null|undefined,options:ContextCacheOptions,loader:()=>Promise<T>,ttlMs=DEFAULT_TTL_MS,now=Date.now()):Promise<T>{
  const key=requestContextCacheKey(accessToken,requestedOrganization,options),existing=cache.get(key);
  if(existing?.promise)return existing.promise as Promise<T>;
  if(existing&&existing.expiresAt>now){existing.touchedAt=now;return existing.value as T}
  const promise=loader();
  cache.set(key,{promise,expiresAt:now+Math.max(0,ttlMs),touchedAt:now,tokenHash:hashToken(accessToken)});
  try{
    const value=await promise,completedAt=Date.now();
    cache.set(key,{value,expiresAt:completedAt+Math.max(0,ttlMs),touchedAt:completedAt,tokenHash:hashToken(accessToken)});
    prune(completedAt);
    return value;
  }catch(error){
    if(cache.get(key)?.promise===promise)cache.delete(key);
    throw error;
  }
}
export function invalidateRequestContextCache(filters:{accessToken?:string;organizationId?:string;userId?:string}={}){
  const tokenHash=filters.accessToken?hashToken(filters.accessToken):null;let removed=0;
  for(const [key,entry] of cache){
    const value=entry.value;
    if(tokenHash&&entry.tokenHash!==tokenHash)continue;
    if(filters.organizationId&&String(value?.membership?.organization_id||'')!==filters.organizationId)continue;
    if(filters.userId&&String(value?.user?.id||'')!==filters.userId)continue;
    cache.delete(key);removed++;
  }
  return removed;
}
export function requestContextCacheSize(){return cache.size}
