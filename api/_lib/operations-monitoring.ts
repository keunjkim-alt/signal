export type ClientMetric={type:string;name:string;durationMs:number;page:string|null;status:number|null;at:string};

const round=(value:number,digits=0)=>{const factor=10**digits;return Math.round(value*factor)/factor};
const percentile=(values:number[],ratio:number)=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b),index=Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*ratio)-1));return sorted[index]};
const average=(values:number[])=>values.length?round(values.reduce((sum,value)=>sum+value,0)/values.length):0;

export function normalizeClientMetrics(input:any):ClientMetric[]{
  const rows=Array.isArray(input)?input.slice(-50):[];
  return rows.map(row=>({
    type:String(row?.type||'').replace(/[^a-z_-]/gi,'').slice(0,24),
    name:String(row?.name||'').replace(/[\r\n\t]/g,' ').slice(0,160),
    durationMs:Math.min(120_000,Math.max(0,Math.round(Number(row?.durationMs)||0))),
    page:row?.page?String(row.page).replace(/[^a-z0-9_-]/gi,'').slice(0,40):null,
    status:Number.isFinite(Number(row?.status))?Math.round(Number(row.status)):null,
    at:!Number.isNaN(new Date(row?.at).getTime())?new Date(row.at).toISOString():new Date().toISOString()
  })).filter(row=>row.type&&row.name&&row.durationMs>=0);
}

function endpointName(name:string){return name.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/,'').replace(/\?.*$/,'')||name}

export function summarizeOperationsMonitoring(input:any={}){
  const telemetry=(input.telemetry||[]).flatMap((event:any)=>normalizeClientMetrics(event?.metadata?.entries||event?.entries||[]));
  const api=telemetry.filter(row=>row.type==='api'),navigation=telemetry.filter(row=>row.type==='navigation'||row.type==='render'),ax=api.filter(row=>row.name.includes('/api/ax/query'));
  const grouped=new Map<string,ClientMetric[]>();for(const row of api){const key=endpointName(row.name);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key)!.push(row)}
  const endpoints=[...grouped.entries()].map(([name,rows])=>{const durations=rows.map(row=>row.durationMs),errors=rows.filter(row=>Number(row.status||0)>=400).length;return {name,requests:rows.length,averageMs:average(durations),p95Ms:percentile(durations,.95),errors,errorRate:rows.length?round(errors/rows.length*100,1):0}}).sort((a,b)=>b.p95Ms-a.p95Ms||b.requests-a.requests).slice(0,12);
  const jobs=input.importJobs||[],runs=input.analyticsRuns||[],sources=input.sources||[],fallbacks=(input.auditEvents||[]).filter((row:any)=>row.action==='ax.router_fallback'),assistantMessages=input.axMessages||[],queryCache=input.queryCache||[];
  const sourceErrors=sources.filter((row:any)=>row.status==='error'||row.data_mode==='stale'),failedJobs=jobs.filter((row:any)=>row.status==='failed'),partialJobs=jobs.filter((row:any)=>row.status==='partial'),failedRuns=runs.filter((row:any)=>row.status==='failed'),apiErrors=api.filter(row=>Number(row.status||0)>=400),slowApi=api.filter(row=>row.durationMs>=1500);
  const attention:any[]=[];
  if(sourceErrors.length)attention.push({severity:'critical',title:`데이터 소스 ${sourceErrors.length}개 확인 필요`,detail:sourceErrors.map((row:any)=>row.name||row.provider).filter(Boolean).slice(0,3).join(' · ')});
  if(failedJobs.length)attention.push({severity:'critical',title:`최근 파일 적재 실패 ${failedJobs.length}건`,detail:'오류 행과 컬럼 매핑을 확인하세요.'});
  if(failedRuns.length)attention.push({severity:'warning',title:`분석 갱신 실패 ${failedRuns.length}건`,detail:'수요예측·할인 추천 갱신 로그를 확인하세요.'});
  if(apiErrors.length)attention.push({severity:'warning',title:`사용자 요청 오류 ${apiErrors.length}건`,detail:'최근 수집된 브라우저 성능 기록 기준입니다.'});
  if(percentile(ax.map(row=>row.durationMs),.95)>=3000)attention.push({severity:'warning',title:'AX 응답 속도 확인 필요',detail:`최근 p95 ${percentile(ax.map(row=>row.durationMs),.95).toLocaleString()}ms`});
  if(!attention.length)attention.push({severity:'healthy',title:'현재 즉시 대응할 운영 위험이 없습니다',detail:'데이터 연결·파일 적재·AX 응답이 정상 범위입니다.'});
  return {
    generatedAt:new Date().toISOString(),windowDays:Number(input.windowDays||7),
    summary:{apiRequests:api.length,apiAverageMs:average(api.map(row=>row.durationMs)),apiP95Ms:percentile(api.map(row=>row.durationMs),.95),apiErrors:apiErrors.length,slowApiRequests:slowApi.length,navigationAverageMs:average(navigation.map(row=>row.durationMs)),axRequests:ax.length,axAverageMs:average(ax.map(row=>row.durationMs)),axP95Ms:percentile(ax.map(row=>row.durationMs),.95),axFallbacks:fallbacks.length,axMessages:assistantMessages.length,cacheHits:queryCache.reduce((sum:number,row:any)=>sum+Number(row.hit_count||0),0),sourceTotal:sources.length,sourceErrors:sourceErrors.length,importTotal:jobs.length,importFailed:failedJobs.length,importPartial:partialJobs.length,analyticsFailed:failedRuns.length},
    attention,endpoints,
    imports:jobs.slice(0,20),sources:sources.slice(0,30),analytics:runs.slice(0,20)
  };
}
