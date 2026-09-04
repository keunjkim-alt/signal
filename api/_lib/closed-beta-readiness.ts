export type ReadinessInput={
  activeMembers:number;
  ownerAdmins:number;
  scopedMembers:number;
  permissionRows:number;
  salesOrders:number;
  salesLines:number;
  inventorySnapshots:number;
  completedSalesImports:number;
  completedInventoryImports:number;
  salesMappings:number;
  inventoryMappings:number;
  salesReconciliation:'matched'|'mismatch'|'missing';
  inventoryReconciliation:'matched'|'mismatch'|'missing';
  analyticsRuns:number;
  analyticsFailures:number;
  axConversations:number;
  auditEvents:number;
  approvedActions:number;
  productionOrders:number;
  reorderIntegrityIssues:number;
  sourceErrors:number;
  openaiConfigured:boolean;
};

export type ReadinessCheck={
  key:string;
  label:string;
  weight:number;
  passed:boolean;
  blocking:boolean;
  detail:string;
  nextAction?:string;
};

export function analyticsReadinessEvidence(runs:any[]=[],jobs:any[]=[]){
  const latestRuns=new Map<string,any>();
  for(const run of runs)if(!latestRuns.has(String(run.pipeline)))latestRuns.set(String(run.pipeline),run);
  if(latestRuns.size)return {runs:latestRuns.size,failures:[...latestRuns.values()].filter((row:any)=>row.status==='failed').length,source:'refresh_runs' as const};
  const latestImports=new Map<string,any>();
  for(const job of jobs)if(!latestImports.has(String(job.entity_type)))latestImports.set(String(job.entity_type),job);
  const analytics=[...latestImports.values()].map((job:any)=>job?.summary?.analytics).filter((item:any)=>item&&item.status!=='skipped'&&item.status!=='blocked');
  return {runs:analytics.length,failures:analytics.filter((item:any)=>item.status==='failed'||Number(item.failed||0)>0).length,source:'import_jobs' as const};
}

export function evaluateClosedBetaReadiness(input:ReadinessInput){
  const checks:ReadinessCheck[]=[
    check('access','계정·회사 격리',10,input.activeMembers>0&&input.ownerAdmins>0,true,`${input.activeMembers}명 활성 · 관리자 ${input.ownerAdmins}명`,'대표 또는 관리자 계정을 활성화하세요.'),
    check('sales','판매 데이터 적재',12,input.completedSalesImports>0&&input.salesOrders>0&&input.salesLines>0,true,`${input.completedSalesImports}회 적재 · 주문 ${input.salesOrders.toLocaleString()}건`,'판매 CSV를 확인 후 적재하세요.'),
    check('inventory','재고 데이터 적재',12,input.completedInventoryImports>0&&input.inventorySnapshots>0,true,`${input.completedInventoryImports}회 적재 · 스냅샷 ${input.inventorySnapshots.toLocaleString()}행`,'재고 CSV를 확인 후 적재하세요.'),
    check('mapping','회사 컬럼 매핑 재사용',8,input.salesMappings>0&&input.inventoryMappings>0,false,`판매 ${input.salesMappings}개 · 재고 ${input.inventoryMappings}개`,'판매·재고 파일을 한 번씩 확인 적재해 회사 매핑을 저장하세요.'),
    check('reconciliation','원천–운영DB 정합성',12,input.salesReconciliation==='matched'&&input.inventoryReconciliation==='matched',true,`판매 ${reconciliationLabel(input.salesReconciliation)} · 재고 ${reconciliationLabel(input.inventoryReconciliation)}`,'데이터 연결의 정합성 검사에서 불일치 행을 확인하세요.'),
    check('analytics','대시보드·예측 갱신',10,input.analyticsRuns>0&&input.analyticsFailures===0&&input.sourceErrors===0,true,`${input.analyticsRuns}개 파이프라인 · 실패 ${input.analyticsFailures}건 · 소스 오류 ${input.sourceErrors}건`,'데이터 소스 또는 분석 갱신 오류를 해결한 뒤 다시 적재하세요.'),
    check('ax','AX 분석·대화 기록',8,input.axConversations>0,false,`${input.axConversations}개 대화 · API ${input.openaiConfigured?'연결':'폴백 모드'}`,'AX에 실제 업무 질문을 1회 실행해 근거와 기록을 확인하세요.'),
    check('execution','승인→실행 업무 연결',12,input.approvedActions>0&&input.productionOrders>0&&input.reorderIntegrityIssues===0,true,`승인 ${input.approvedActions}건 · 생산오더 ${input.productionOrders}건 · 정합성 오류 ${input.reorderIntegrityIssues}건`,'재고 이동 또는 재주문을 승인하고 생산 실행 큐를 확인하세요.'),
    check('permissions','역할·페이지 권한',8,input.activeMembers===1||input.scopedMembers===0||input.permissionRows>0,true,`범위 사용자 ${input.scopedMembers}명 · 권한 규칙 ${input.permissionRows}개`,'팀 계정에 조회·수정·승인 범위를 지정하세요.'),
    check('audit','감사 이력',8,input.auditEvents>0,true,`${input.auditEvents}개 변경·승인 기록`,'파일 적재나 승인 작업을 실행해 감사 이력을 생성하세요.')
  ];
  const score=checks.reduce((sum,item)=>sum+(item.passed?item.weight:0),0),blockers=checks.filter(item=>item.blocking&&!item.passed),warnings=checks.filter(item=>!item.blocking&&!item.passed);
  return {score,ready:score===100&&blockers.length===0,checks,blockers,warnings,measuredAt:new Date().toISOString()};
}

function check(key:string,label:string,weight:number,passed:boolean,blocking:boolean,detail:string,nextAction:string):ReadinessCheck{return {key,label,weight,passed,blocking,detail,...(!passed?{nextAction}:{})}}
function reconciliationLabel(value:ReadinessInput['salesReconciliation']){return value==='matched'?'일치':value==='mismatch'?'불일치':'미검사'}
