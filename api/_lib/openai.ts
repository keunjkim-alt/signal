import {heuristicPlan,normalizeQuerySpec} from './semantic.js';

const schema={type:'object',additionalProperties:false,required:['metric','dimension','visualization','periodDays','filters','limit','title','explanation'],properties:{metric:{type:'string',enum:['net_sales','quantity','orders','available_qty','inventory_cover_days','contribution_margin','return_rate','sell_through_rate','exposure_score','best_rank','avg_rank','product_count','top_100_count','avg_discount_rate','avg_rating','total_review_count']},dimension:{type:'string',enum:['day','channel','location','product','brand','platform','category','market_product']},visualization:{type:'string',enum:['kpi','bar','line','area','table','heatmap','quadrant','bubble','timeline','rank']},periodDays:{type:'integer',minimum:1,maximum:366},filters:{type:'object',additionalProperties:false,required:['country','channel','platform'],properties:{country:{type:['string','null']},channel:{type:['string','null']},platform:{type:['string','null']}}},limit:{type:'integer',minimum:1,maximum:100},title:{type:'string'},explanation:{type:'string'}}};

export type AnalysisPlan=ReturnType<typeof normalizeQuerySpec>&{title:string;explanation:string;source:'heuristic'|'openai';model?:string;usage?:any};

export async function createAnalysisPlan(question:string,page:string,filters:any={},options:{useModel?:boolean}={}):Promise<AnalysisPlan>{
  if(options.useModel===false||!process.env.OPENAI_API_KEY){const query=heuristicPlan(question,page);return {...query,filters:{...query.filters,...filters},title:question||'AX 분석',explanation:'사전 계산된 지표를 조회하는 규칙 기반 분석입니다.',source:'heuristic'}}
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.min(20000,Math.max(3000,Number(process.env.OPENAI_ROUTER_TIMEOUT_MS)||8000)));
  let response:Response;
  try{response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_ROUTER_MODEL||'gpt-5.6-luna',reasoning:{effort:'none'},max_output_tokens:1200,store:false,input:[{role:'developer',content:[{type:'input_text',text:'VIIMsignal 분석 라우터. 질문을 허용된 지표·차원·차트 명세로 변환한다. SQL, HTML, 코드, 개인정보는 출력하지 않는다. 현재 페이지와 필터를 유지한다.'}]},{role:'user',content:[{type:'input_text',text:JSON.stringify({question,page,filters})}]}],text:{verbosity:'low',format:{type:'json_schema',name:'fashion_ax_analysis_plan',strict:true,schema}}})})}catch(error:any){
    if(error?.name==='AbortError'||error?.code==='UND_ERR_CONNECT_TIMEOUT'){const query=heuristicPlan(question,page);return {...query,filters:{...query.filters,...filters},title:question||'AX 분석',explanation:'빠른 응답을 위해 사전 정의된 지표 라우터로 분석했습니다.',source:'heuristic'}}
    throw error;
  }finally{clearTimeout(timeout)}
  const payload=await response.json();
  if(!response.ok){
    const code=payload?.error?.code||payload?.error?.type;
    if(response.status===429||response.status>=500){const query=heuristicPlan(question,page);return {...query,filters:{...query.filters,...filters},title:question||'AX 분석',explanation:'AI 라우터가 혼잡해 사전 정의된 지표 라우터로 분석했습니다.',source:'heuristic'}}
    const error:any=new Error(response.status===401||code==='invalid_api_key'?'서버의 OpenAI API 키가 유효하지 않습니다. 관리자가 키를 교체한 뒤 다시 시도해주세요.':payload?.error?.message||'OpenAI 분석 계획 생성에 실패했습니다.');
    error.status=502;error.code=code||'OPENAI_UPSTREAM_ERROR';throw error;
  }
  const outputText=payload.output_text||payload.output?.flatMap((item:any)=>item.content||[]).find((item:any)=>item.type==='output_text')?.text;
  if(!outputText)throw new Error('OpenAI returned no structured analysis plan');
  const parsed=JSON.parse(outputText);
  return {...normalizeQuerySpec(parsed),title:parsed.title,explanation:parsed.explanation,source:'openai',model:payload.model,usage:payload.usage||null};
}
