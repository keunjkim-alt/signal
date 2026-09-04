import {heuristicPlan,normalizeQuerySpec} from './semantic.js';

const schema={type:'object',additionalProperties:false,required:['metric','dimension','visualization','periodDays','filters','limit','title','explanation'],properties:{metric:{type:'string',enum:['net_sales','quantity','orders','available_qty','inventory_cover_days','contribution_margin','return_rate','sell_through_rate','exposure_score','best_rank','avg_rank','product_count','top_100_count','avg_discount_rate','avg_rating','total_review_count']},dimension:{type:'string',enum:['day','channel','location','product','brand','platform','category','market_product']},visualization:{type:'string',enum:['kpi','bar','line','area','table','heatmap','quadrant','bubble','timeline','rank']},periodDays:{type:'integer',minimum:1,maximum:366},filters:{type:'object',additionalProperties:false,required:['country','channel','platform','location','product'],properties:{country:{type:['string','null']},channel:{type:['string','null']},platform:{type:['string','null']},location:{type:['string','null']},product:{type:['string','null']}}},limit:{type:'integer',minimum:1,maximum:100},title:{type:'string'},explanation:{type:'string'}}};

export type AnalysisPlan=ReturnType<typeof normalizeQuerySpec>&{title:string;explanation:string;source:'heuristic'|'openai';model?:string;usage?:any;degraded?:boolean;warning?:string;warningCode?:string};

function heuristicFallback(question:string,page:string,filters:any,options:{degraded?:boolean;warning?:string;warningCode?:string}={}):AnalysisPlan{
  const query=heuristicPlan(question,page);
  return {...query,filters:{...query.filters,...filters},title:question||'AX 분석',explanation:options.degraded?'AI 라우터 대신 검증된 지표 규칙으로 분석을 완료했습니다.':'사전 계산된 지표를 조회하는 규칙 기반 분석입니다.',source:'heuristic',degraded:Boolean(options.degraded),warning:options.warning,warningCode:options.warningCode};
}

export async function createAnalysisPlan(question:string,page:string,filters:any={},options:{useModel?:boolean;conversationContext?:any;recentMessages?:any[]}={}):Promise<AnalysisPlan>{
  if(options.useModel===false)return heuristicFallback(question,page,filters);
  if(!process.env.OPENAI_API_KEY)return heuristicFallback(question,page,filters,{degraded:true,warning:'AI 연결 없이 사전 계산 지표로 분석했습니다.',warningCode:'OPENAI_NOT_CONFIGURED'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.min(12000,Math.max(2500,Number(process.env.OPENAI_ROUTER_TIMEOUT_MS)||4500)));
  let response:Response;
  try{response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_ROUTER_MODEL||process.env.OPENAI_MODEL||'gpt-5.6-luna',reasoning:{effort:'none'},max_output_tokens:500,store:false,input:[{role:'developer',content:[{type:'input_text',text:'VIIMsignal 분석 라우터. 현재 질문을 허용된 지표·차원·차트 명세로 변환한다. 이전 문맥은 생략된 조건만 보완하며 현재 질문과 화면 필터가 항상 우선한다. SQL, HTML, 코드, 개인정보, 임의의 데이터 값은 출력하지 않는다.'}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({question,page,filters,conversationContext:options.conversationContext||null,recentMessages:(options.recentMessages||[]).slice(-8)})}]}],text:{verbosity:'low',format:{type:'json_schema',name:'fashion_ax_analysis_plan',strict:true,schema}}})})}catch(error:any){
    const timedOut=error?.name==='AbortError'||error?.code==='UND_ERR_CONNECT_TIMEOUT';
    return heuristicFallback(question,page,filters,{degraded:true,warning:timedOut?'AI 응답 시간이 길어져 빠른 지표 분석으로 전환했습니다.':'AI 연결 오류로 빠른 지표 분석으로 전환했습니다.',warningCode:timedOut?'OPENAI_TIMEOUT':'OPENAI_NETWORK'});
  }finally{clearTimeout(timeout)}
  let payload:any;try{payload=await response.json()}catch{return heuristicFallback(question,page,filters,{degraded:true,warning:'AI 응답을 해석하지 못해 빠른 지표 분석으로 전환했습니다.',warningCode:'OPENAI_INVALID_RESPONSE'})}
  if(!response.ok){
    const code=payload?.error?.code||payload?.error?.type;
    const auth=response.status===401||code==='invalid_api_key',busy=response.status===429||response.status>=500;
    return heuristicFallback(question,page,filters,{degraded:true,warning:auth?'AI 연결 설정을 확인하는 동안 사전 계산 지표로 분석했습니다.':busy?'AI 사용량 또는 서비스 혼잡으로 빠른 지표 분석으로 전환했습니다.':'AI 분석 요청이 거절되어 빠른 지표 분석으로 전환했습니다.',warningCode:auth?'OPENAI_AUTH':busy?'OPENAI_BUSY':String(code||'OPENAI_UPSTREAM_ERROR')});
  }
  const outputText=payload.output_text||payload.output?.flatMap((item:any)=>item.content||[]).find((item:any)=>item.type==='output_text')?.text;
  if(!outputText)return heuristicFallback(question,page,filters,{degraded:true,warning:'AI 응답이 비어 있어 빠른 지표 분석으로 전환했습니다.',warningCode:'OPENAI_EMPTY_RESPONSE'});
  let parsed:any;try{parsed=JSON.parse(outputText)}catch{return heuristicFallback(question,page,filters,{degraded:true,warning:'AI 응답 형식을 확인할 수 없어 빠른 지표 분석으로 전환했습니다.',warningCode:'OPENAI_INVALID_RESPONSE'})}
  return {...normalizeQuerySpec(parsed),title:parsed.title,explanation:parsed.explanation,source:'openai',model:payload.model,usage:payload.usage||null};
}
