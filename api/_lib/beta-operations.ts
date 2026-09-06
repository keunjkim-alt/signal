const priorityMap:Record<string,string>={P0:'p0',P1:'p1',P2:'p2',P3:'p3'};

function dueAt(value:any,now=new Date()){
  const text=String(value||'').trim(),match=text.match(/(오늘|내일)\s*(\d{1,2}):?(\d{2})?/);
  if(!match)return null;
  const date=new Date(now);date.setDate(date.getDate()+(match[1]==='내일'?1:0));date.setHours(Number(match[2]),Number(match[3]||0),0,0);return date.toISOString();
}

const criteria:Record<string,string[]>={
  return_mitigation:['상위 반품·취소 원인 확인','상품·채널 개선안 적용','적용 후 반품률 재측정'],
  customer_growth:['대상 고객군과 지역 확정','캠페인 또는 CRM 실험 설정','성과 측정 기준 기록'],
  review_response:['리뷰 주제와 영향 SKU 확인','담당팀 개선 조치 등록','후속 리뷰 지표 재측정'],
  marketing_followup:['대상·예산·채널 확정','캠페인 실행 상태 갱신','증분 매출과 기여이익 확인']
};

export function buildOperationalTask(action:any,now=new Date()){
  const execution=action?.execution||{},taskType=String(execution.taskType||action?.kind||'followup'),team=String(execution.owner||action?.owner||action?.team_code||'담당팀');
  return {task_type:taskType,priority:priorityMap[String(action?.priority||'P2')]||'p2',status:'ready',title:String(action?.recommendation||action?.title||'후속 실행 과제'),description:String(action?.basis||''),assigned_team:team,due_at:dueAt(action?.due,now),completion_criteria:criteria[taskType]||['담당자와 완료일 확정','실행 결과 기록','관련 지표 재확인'],metadata:{source:'today_action',action_key:String(action?.key||''),target_page:String(execution.targetPage||action?.target_page||'action'),focus:execution.focus||null,metrics:execution.metrics||{},impact:action?.impact||null,confidence:action?.confidence||null}};
}

export function deriveOperationalNotifications(input:any={},now=new Date()){
  const actions=input.actions||[],tasks=input.tasks||[],executions=input.executions||[],outcomes=input.outcomes||[],items:any[]=[];
  for(const action of actions){if(action.priority==='P0'&&!['approved','executed'].includes(action.decision_status))items.push({id:`action:${action.key}`,priority:'p0',kind:'decision',title:'지금 결정이 필요합니다',message:action.title,page:'action',objectId:action.key});}
  for(const task of tasks){const overdue=task.due_at&&new Date(task.due_at).getTime()<now.getTime()&&!['completed','cancelled'].includes(task.status);if(overdue)items.push({id:`task:${task.id}:overdue`,priority:task.priority==='p0'?'p0':'p1',kind:'task',title:'실행 기한이 지났습니다',message:task.title,page:task.metadata?.target_page||'execution',objectId:task.id});else if(task.status==='ready')items.push({id:`task:${task.id}:ready`,priority:task.priority||'p2',kind:'task',title:'담당팀 실행 대기',message:task.title,page:'execution',objectId:task.id});}
  for(const execution of executions){const overdue=execution.metadata?.requested_execution_date&&new Date(`${execution.metadata.requested_execution_date}T23:59:59`).getTime()<now.getTime()&&!['completed','cancelled','failed'].includes(execution.status);if(overdue)items.push({id:`execution:${execution.id}:overdue`,priority:'p1',kind:'execution',title:'승인 후 실행이 지연되고 있습니다',message:execution.execution_no,page:'execution',objectId:execution.id});if(execution.status==='completed'&&!outcomes.some((row:any)=>row.execution_request_id===execution.id&&row.outcome_status==='complete'))items.push({id:`execution:${execution.id}:measure`,priority:'p2',kind:'outcome',title:'실행 효과 측정 대기',message:`${execution.execution_no} · D+7·14·28 추적 예정`,page:'execution',objectId:execution.id});}
  const rank:any={p0:0,p1:1,p2:2,p3:3};return items.sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||a.title.localeCompare(b.title,'ko')).slice(0,20);
}

export function buildBrandOnboardingChecklist(input:any={}){
  const entityTypes=new Set((input.imports||[]).filter((row:any)=>['completed','partial'].includes(row.status||row.job_status||'completed')).map((row:any)=>row.entity_type||row.entityType));
  const steps=[
    {key:'workspace',label:'워크스페이스·사용자',required:true,complete:Boolean(input.hasWorkspace&&input.hasUsers)},
    {key:'product_master',label:'상품·SKU 마스터',required:true,complete:entityTypes.has('product_master')||Boolean(input.hasProducts)},
    {key:'sales_order',label:'판매·고객·반품',required:true,complete:entityTypes.has('sales_order')||Boolean(input.hasSales)},
    {key:'inventory_snapshot',label:'위치별 재고',required:true,complete:entityTypes.has('inventory_snapshot')||Boolean(input.hasInventory)},
    {key:'product_review',label:'리뷰·VOC',required:false,complete:entityTypes.has('product_review')||Boolean(input.hasReviews)},
    {key:'mapping',label:'컬럼 매핑 확인',required:true,complete:Boolean(input.hasMapping)},
    {key:'validation',label:'정합성 검사',required:true,complete:Boolean(input.reconciliationReady)}
  ];
  const required=steps.filter(row=>row.required),completed=required.filter(row=>row.complete).length;return {steps,percent:Math.round(completed/required.length*100),ready:completed===required.length,blockers:required.filter(row=>!row.complete).map(row=>row.label)};
}
