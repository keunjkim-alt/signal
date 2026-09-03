const RETRYABLE_IMPORT_STATUSES=new Set(['failed','partial']);

export function validateImportRetry(job:any){
  if(!job?.id)throw Object.assign(new Error('적재 작업을 찾을 수 없습니다.'),{status:404});
  if(!RETRYABLE_IMPORT_STATUSES.has(String(job.status)))throw Object.assign(new Error('실패 또는 일부 완료된 적재만 다시 실행할 수 있습니다.'),{status:409});
  if(!job.raw_upload_id)throw Object.assign(new Error('재실행할 원본 파일이 남아 있지 않습니다.'),{status:409});
  if(!job.entity_type)throw Object.assign(new Error('원본 데이터 유형을 확인할 수 없습니다.'),{status:409});
  return {jobId:String(job.id),uploadId:String(job.raw_upload_id),sourceId:job.data_source_id?String(job.data_source_id):'',entityType:String(job.entity_type),mapping:job.summary?.mapping||{}};
}

export function sourceOperationsView(source:any){
  const operations=source?.config?.operations||{};
  return {
    ...source,
    config:undefined,
    assigneeMembershipId:operations.assignee_membership_id||null,
    assignedAt:operations.assigned_at||null
  };
}

export function sourceAssignmentUpdate(source:any,membership:any,actorUserId:string,now=new Date().toISOString()){
  if(!source?.id)throw Object.assign(new Error('데이터 소스를 찾을 수 없습니다.'),{status:404});
  if(!membership?.id||membership.status!=='active')throw Object.assign(new Error('활성 사용자만 담당자로 지정할 수 있습니다.'),{status:422});
  const config={...(source.config||{})};
  return {config:{...config,operations:{...(config.operations||{}),assignee_membership_id:membership.id,assignee_user_id:membership.user_id,assigned_at:now,assigned_by:actorUserId}},updated_at:now};
}
