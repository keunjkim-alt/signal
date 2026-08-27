const ACTIONS=['pause','resume','archive','restore'] as const;
export type SourceLifecycleAction=(typeof ACTIONS)[number];

export function isSourceLifecycleAction(value:any):value is SourceLifecycleAction{
  return ACTIONS.includes(String(value) as SourceLifecycleAction);
}

export function sourceLifecycleUpdate(source:any,action:SourceLifecycleAction,userId:string,now=new Date().toISOString()){
  const config={...(source?.config||{})},lifecycle={...(config.lifecycle||{})};
  if(action==='pause'){
    if(lifecycle.archived_at)throw Object.assign(new Error('보관된 소스는 먼저 보관을 해제해야 합니다.'),{status:409});
    return {status:'paused',config:{...config,lifecycle:{...lifecycle,paused_at:now,paused_by:userId}},updated_at:now};
  }
  if(action==='resume'){
    if(lifecycle.archived_at)throw Object.assign(new Error('보관된 소스는 먼저 보관을 해제해야 합니다.'),{status:409});
    return {status:'active',config:{...config,lifecycle:{...lifecycle,resumed_at:now,resumed_by:userId}},updated_at:now};
  }
  if(action==='archive'){
    return {status:'paused',config:{...config,lifecycle:{...lifecycle,archived_at:now,archived_by:userId}},updated_at:now};
  }
  const restoredLifecycle={...lifecycle,archived_at:null,archived_by:null,restored_at:now,restored_by:userId};
  return {status:'paused',config:{...config,lifecycle:restoredLifecycle},updated_at:now};
}
