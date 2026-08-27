import {supabase} from './supabase.js';

export function isConnectorSystemRequest(request:Request){const expected=process.env.CRON_SECRET||'';return Boolean(expected&&request.headers.get('authorization')===`Bearer ${expected}`)}

export async function connectorSystemContext(request:Request,sourceId:string){
  if(!isConnectorSystemRequest(request))return null;
  if(!sourceId)throw Object.assign(new Error('자동 동기화 sourceId가 필요합니다.'),{status:400});
  const query=new URLSearchParams({id:`eq.${sourceId}`,select:'id,organization_id,created_by',limit:'1'}),source=((await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[])[0];
  if(!source)throw Object.assign(new Error('자동 동기화 소스를 찾을 수 없습니다.'),{status:404});
  const actorId=source.created_by||process.env.CONNECTOR_SYSTEM_USER_ID;if(!actorId)throw Object.assign(new Error('소스 등록자 또는 CONNECTOR_SYSTEM_USER_ID가 필요합니다.'),{status:409});
  return {user:{id:actorId},membership:{organization_id:source.organization_id,role:'owner'},permissions:[],system:true};
}
