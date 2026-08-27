export type OperationalSeverity='info'|'warning'|'critical';
export type AttentionStatus='open'|'acknowledged'|'in_progress'|'resolved'|'dismissed';
export type TaskStatus='ready'|'in_progress'|'verification'|'completed'|'cancelled';

type Rule={category:string;team:string;responseMinutes:number;resolutionMinutes:number;title:string;completionCriteria:string[];incident?:'p0'|'p1'};

const rules:Record<string,Rule>={
  'sync.failed':{category:'data',team:'data_ops',responseMinutes:30,resolutionMinutes:120,title:'데이터 동기화 실패',completionCriteria:['최신 데이터 적재 확인','영향 지표 재계산 확인']},
  'data.freshness_degraded':{category:'data',team:'data_ops',responseMinutes:60,resolutionMinutes:240,title:'데이터 최신성 기준 초과',completionCriteria:['최신성 기준 정상화','마지막 정상 시각 갱신']},
  'data_quality.degraded':{category:'data_quality',team:'data_ops',responseMinutes:60,resolutionMinutes:240,title:'데이터 품질 기준 미달',completionCriteria:['품질 Gate 통과','격리 행 영향 확인']},
  'recommendation.generation_failed':{category:'recommendation',team:'product_ops',responseMinutes:60,resolutionMinutes:120,title:'추천 생성 실패',completionCriteria:['추천 Job 정상 완료','기대 대상 추천 생성 확인']},
  'recommendation.review_overdue':{category:'adoption',team:'customer_success',responseMinutes:60,resolutionMinutes:480,title:'추천 검토 기한 초과',completionCriteria:['고객 검토 또는 지연 사유 기록']},
  'action.execution_overdue':{category:'execution',team:'product_ops',responseMinutes:60,resolutionMinutes:240,title:'승인 후 실행 지연',completionCriteria:['실행 결과 확인','고객에게 상태 안내']},
  'outcome.measurement_failed':{category:'outcome',team:'product_ops',responseMinutes:240,resolutionMinutes:1440,title:'성과 측정 실패',completionCriteria:['누락 데이터 보완','성과 계산 완료']},
  'adoption.dropped':{category:'adoption',team:'customer_success',responseMinutes:480,resolutionMinutes:4320,title:'고객 사용량 급감',completionCriteria:['감소 원인 기록','고객 후속 일정 확정']},
  'security.access_anomaly':{category:'security',team:'security',responseMinutes:0,resolutionMinutes:60,title:'비정상 접근 감지',completionCriteria:['세션 차단 확인','보안 조사 기록'],incident:'p0'},
  'contract.sla_risk':{category:'contract',team:'service_ops',responseMinutes:120,resolutionMinutes:1440,title:'SLA 위반 위험',completionCriteria:['영향 시간 확정','고객 안내 또는 보상 검토']}
};

const addMinutes=(date:Date,minutes:number)=>new Date(date.getTime()+minutes*60000).toISOString();
export function eventDedupeKey(event:any){return String(event.dedupe_key||event.correlation_id||`${event.event_type}:${event.object_type}:${event.object_id||'unknown'}`)}

export function evaluateOperationalEvent(event:any,now=new Date()){
  const base=rules[event.event_type];if(!base)return {createAttention:false,reason:'unmapped_event'} as const;
  const payload=event.payload||{};let severity:OperationalSeverity=event.severity||'warning',incident=base.incident||null;
  if(event.event_type==='sync.failed'&&(payload.retry_exhausted||Number(payload.affected_workspaces||0)>=2)){severity='critical';incident=Number(payload.affected_workspaces||0)>=2?'p0':'p1'}
  if(event.event_type==='data_quality.degraded'&&payload.live_blocked)severity='critical';
  if(event.event_type==='outcome.measurement_failed'&&payload.critical_action)severity='critical';
  if(severity==='info'&&!payload.force_attention)return {createAttention:false,reason:'informational'} as const;
  const responseMinutes=severity==='critical'?Math.min(base.responseMinutes,15):base.responseMinutes,resolutionMinutes=severity==='critical'?Math.min(base.resolutionMinutes,120):base.resolutionMinutes,dedupeKey=eventDedupeKey(event);
  return {createAttention:true,dedupeKey,severity,category:base.category,assignedTeam:base.team,title:String(payload.title||base.title),summary:String(payload.summary||''),responseDueAt:addMinutes(now,responseMinutes),resolutionDueAt:addMinutes(now,resolutionMinutes),completionCriteria:base.completionCriteria,incident,priority:incident==='p0'?'p0':severity==='critical'?'p1':'p2'} as const;
}

const attentionTransitions:Record<AttentionStatus,AttentionStatus[]>={open:['acknowledged','dismissed'],acknowledged:['in_progress','dismissed'],in_progress:['resolved'],resolved:[],dismissed:[]};
const taskTransitions:Record<TaskStatus,TaskStatus[]>={ready:['in_progress','cancelled'],in_progress:['verification','cancelled'],verification:['in_progress','completed'],completed:[],cancelled:[]};
export function canTransitionAttention(from:AttentionStatus,to:AttentionStatus){return attentionTransitions[from]?.includes(to)||false}
export function canTransitionTask(from:TaskStatus,to:TaskStatus){return taskTransitions[from]?.includes(to)||false}
export function requireAttentionTransition(from:AttentionStatus,to:AttentionStatus){if(!canTransitionAttention(from,to)){const error:any=new Error(`Invalid attention transition: ${from} -> ${to}`);error.status=409;throw error}}
export function requireTaskTransition(from:TaskStatus,to:TaskStatus){if(!canTransitionTask(from,to)){const error:any=new Error(`Invalid task transition: ${from} -> ${to}`);error.status=409;throw error}}

export function resolutionRequirements(input:{sourceHealthy?:boolean;resolutionNote?:string;manualOverride?:boolean}){
  const missing=[];if(!input.sourceHealthy&&!input.manualOverride)missing.push('sourceHealthy');if(!String(input.resolutionNote||'').trim())missing.push('resolutionNote');return {ready:missing.length===0,missing};
}
