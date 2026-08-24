import {createHash} from 'node:crypto';
import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {createAnalysisPlan} from '../_lib/openai.js';
import {intelligenceMode,requiresOpenAI} from '../_lib/semantic.js';
import {audit,insert,requestContext,requirePagePermission,supabase,update} from '../_lib/supabase.js';
import {customerReturnInsights,runDashboardQuery} from '../dashboards/query.js';

const allowedActions=['approved','adjustment_requested','review_requested','held'];
const stable=(value:any):string=>value&&typeof value==='object'?(Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`):JSON.stringify(value);
const normalizeQuestion=(value:string)=>value.toLowerCase().replace(/\s+/g,' ').trim();
async function latestWatermark(org:string){
  const sourceQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'last_synced_at',order:'last_synced_at.desc.nullslast',limit:'1'});
  const forecastQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'generated_at',order:'generated_at.desc',limit:'1'});
  const featureQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'updated_at',order:'updated_at.desc',limit:'1'});
  const discountQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'generated_at',order:'generated_at.desc',limit:'1'});
  const [source,forecast,feature,discount]=await Promise.all([
    supabase(`/rest/v1/data_sources?${sourceQuery}`,{serviceRole:true}),supabase(`/rest/v1/forecast_snapshots?${forecastQuery}`,{serviceRole:true}),supabase(`/rest/v1/analysis_feature_snapshots?${featureQuery}`,{serviceRole:true}),supabase(`/rest/v1/discount_recommendation_snapshots?${discountQuery}`,{serviceRole:true})
  ]);
  return [source.data?.[0]?.last_synced_at,forecast.data?.[0]?.generated_at,feature.data?.[0]?.updated_at,discount.data?.[0]?.generated_at].filter(Boolean).sort().at(-1)||null;
}
async function cachedPlan(org:string,key:string){const query=new URLSearchParams({organization_id:`eq.${org}`,cache_key:`eq.${key}`,expires_at:`gt.${new Date().toISOString()}`,select:'id,plan_spec,result_spec,model,hit_count',limit:'1'});return ((await supabase(`/rest/v1/ax_query_cache?${query}`,{serviceRole:true})).data||[])[0]||null}
function rowsForRequestedProduct(rows:any[],question:string){
  const compactQuestion=normalizeQuestion(question).replace(/\s+/g,'');
  const matching=rows.filter(row=>[row?.product_code,row?.product_name].some(value=>{
    const candidate=String(value||'').toLowerCase().replace(/\s+/g,'');
    return candidate.length>=4&&compactQuestion.includes(candidate);
  }));
  return matching.length?matching:rows;
}
async function productIntelligence(context:any,page:string,mode:'matching'|'forecast'|'discount'|'customer'|'returns',question=''){
  if(mode==='customer'||mode==='returns'){
    const data=await customerReturnInsights(context),insight=mode==='customer'?data.customer:data.returns;
    const rows=mode==='customer'?insight.regions||[]:insight.products||[];
    return {spec:{source:'precomputed_operational_insight',mode,visualization:mode==='customer'?'table':'bar'},data:{rows,summary:insight.summary,profileCoverage:insight.profileCoverage||null,reasonCoverage:insight.reasonCoverage||null,source:'precomputed_operational_insight',note:mode==='customer'?'익명 고객 토큰과 시군구 배송지역만 집계했습니다.':'주문·반품 수량·취소 상태에서 계산했습니다.'}};
  }
  if(mode==='discount'){
    const data=(await supabase('/rest/v1/rpc/query_discount_recommendations',{method:'POST',token:context.accessToken,body:{p_organization_id:context.membership.organization_id,p_page_key:page,p_limit:40}})).data;
    const rows=rowsForRequestedProduct(data?.recommendations||[],question);
    return {spec:{source:'precomputed_intelligence',mode,visualization:'curve'},data:{rows,source:'precomputed_intelligence',note:data?.note,objective:data?.objective,guardrail:data?.guardrail}};
  }
  const data=(await supabase('/rest/v1/rpc/query_product_intelligence',{method:'POST',token:context.accessToken,body:{p_organization_id:context.membership.organization_id,p_page_key:page,p_limit:30}})).data;
  const rows=mode==='matching'?data?.matches||[]:data?.forecasts||[];
  return {spec:{source:'precomputed_intelligence',mode,visualization:mode==='matching'?'table':'bar'},data:{rows,source:'precomputed_intelligence',note:mode==='matching'?data?.matching_note:data?.forecast_note}};
}

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  try{const context=await requestContext(request);const body=await bodyJson(request),page=String(body?.page||'hub'),org=context.membership.organization_id;
    if(body?.action){const conversationId=String(body?.conversationId||''),action=String(body.action||'');if(!conversationId||!allowedActions.includes(action))return json({ok:false,error:'Valid conversationId and action are required'},400);requirePagePermission(context,page,action==='approved'?'approve':'update');const conversationQuery=new URLSearchParams({id:`eq.${conversationId}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`,select:'id'});const conversation=((await supabase(`/rest/v1/ax_conversations?${conversationQuery}`,{serviceRole:true})).data||[])[0];if(!conversation)return json({ok:false,error:'Conversation not found'},404);const recommendationKey=String(body?.recommendationKey||`${page}:primary`).slice(0,120),now=new Date().toISOString();const recommendation=(await insert('ax_recommendations',{organization_id:org,conversation_id:conversationId,recommendation_key:recommendationKey,page_key:page,title:String(body?.title||'AX 추천 실행안').slice(0,180),status:action,payload:body?.payload||{},created_by:context.user.id,updated_at:now,approved_by:action==='approved'?context.user.id:null,approved_at:action==='approved'?now:null},{upsert:true,onConflict:'organization_id,conversation_id,recommendation_key'}))?.[0];await insert('ax_action_events',{organization_id:org,recommendation_id:recommendation.id,conversation_id:conversationId,actor_user_id:context.user.id,action,payload:body?.payload||{}});await audit(context,`ax.${action}`,'ax_recommendation',recommendation.id,{conversationId,page,recommendationKey});return json({ok:true,recommendation})}
    requirePagePermission(context,page,'view');const question=String(body?.question||'').trim();if(!question)return json({ok:false,error:'question is required'},400);
    const filters=body?.filters||{},mode=intelligenceMode(question,page),normalized=normalizeQuestion(question),useModel=!mode&&requiresOpenAI(question),useCache=useModel,watermark=useCache?await latestWatermark(org):null,cacheKey=useCache?createHash('sha256').update(stable({cacheVersion:'intelligence-v4',page,question:normalized,filters,watermark})).digest('hex'):'';let cache=useCache?await cachedPlan(org,cacheKey):null,plan:any;
    if(cache){plan={...cache.plan_spec,source:'cache',model:cache.model||null};await update('ax_query_cache',{id:`eq.${cache.id}`},{hit_count:Number(cache.hit_count||0)+1,updated_at:new Date().toISOString()})}else if(mode==='discount')plan={metric:'discount',dimension:'product',visualization:'curve',periodDays:14,filters,title:'상품·채널별 최적 할인 추천',explanation:'저장된 가격 탄력성·기여이익·재고 위험 시나리오에서 최적 할인값을 조회했습니다.',source:'precomputed_intelligence',model:null};else if(mode==='forecast')plan={metric:'forecast',dimension:'product',visualization:'bar',periodDays:14,filters,title:'제품별 14일 수요예측과 재고 커버',explanation:'저장된 판매속도·재고 스냅샷에서 예측 판매량과 재주문 필요 수량을 조회했습니다.',source:'precomputed_intelligence',model:null};else if(mode==='matching')plan={metric:'matching',dimension:'product',visualization:'table',periodDays:1,filters,title:'자사 상품과 외부 경쟁 상품 매칭',explanation:'스타일·가격·순위·리뷰 특징으로 미리 계산한 매칭 추천을 조회했습니다.',source:'precomputed_intelligence',model:null};else if(mode==='customer')plan={metric:'orders',dimension:'location',visualization:'table',periodDays:90,filters,title:'고객·지역 재구매 신호',explanation:'저장된 익명 고객 토큰과 시군구 배송지역 집계를 조회했습니다.',source:'precomputed_operational_insight',model:null};else if(mode==='returns')plan={metric:'return_rate',dimension:'product',visualization:'bar',periodDays:90,filters,title:'반품·취소 위험 신호',explanation:'저장된 주문·반품 수량·취소 상태에서 제품별 위험을 조회했습니다.',source:'precomputed_operational_insight',model:null};else plan=await createAnalysisPlan(question,page,filters,{useModel});
    let conversationId=String(body?.conversationId||'');if(conversationId){const check=new URLSearchParams({id:`eq.${conversationId}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`,select:'id'});if(!((await supabase(`/rest/v1/ax_conversations?${check}`,{token:context.accessToken})).data||[]).length)return json({ok:false,error:'Conversation not found'},404)}else{const created=(await insert('ax_conversations',{organization_id:org,user_id:context.user.id,title:question.slice(0,80),page_key:page,status:'active'}))?.[0];conversationId=created.id}
    const queryTask=(async()=>{try{return cache?.result_spec?cache.result_spec:mode?await productIntelligence(context,page,mode,question):await runDashboardQuery(context,{...plan,page,filters:{...plan.filters,...filters}})}catch(error:any){return {spec:plan,data:{rows:[]},warning:error.message}}})();
    const [,queryResult]=await Promise.all([insert('ax_messages',{organization_id:org,conversation_id:conversationId,user_id:context.user.id,role:'user',content:question,page_key:page,source:'user'}),queryTask]);
    const modeDimension=mode==='customer'?'location':mode?'product':plan.dimension,visualization={type:mode==='matching'||mode==='customer'?'table':mode==='forecast'||mode==='returns'?'bar':mode==='discount'?'curve':plan.visualization,title:plan.title,explanation:plan.explanation,metric:mode||plan.metric,dimension:modeDimension,rows:queryResult.data?.rows||[]},answer=queryResult.warning?`${plan.explanation} 현재 조건에서는 일부 데이터 조회가 제한되었습니다.`:`${plan.explanation} ${visualization.rows.length}개 결과를 현재 권한 범위에서 조회했습니다.${queryResult.data?.note?` ${queryResult.data.note}`:''}`;
    const persisted=[insert('ax_messages',{organization_id:org,conversation_id:conversationId,user_id:context.user.id,role:'assistant',content:answer,page_key:page,query_spec:queryResult.spec,visualization_spec:visualization,model:plan.model||null,source:plan.source||'heuristic'}),update('ax_conversations',{id:`eq.${conversationId}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`},{page_key:page,last_message_at:new Date().toISOString(),updated_at:new Date().toISOString()})];
    if(useCache&&!cache)persisted.push(insert('ax_query_cache',{organization_id:org,cache_key:cacheKey,page_key:page,question_normalized:normalized,filters,plan_spec:plan,result_spec:queryResult,data_watermark:watermark,model:plan.model||null,token_usage:plan.usage||null,expires_at:new Date(Date.now()+15*60*1000).toISOString()},{upsert:true,onConflict:'organization_id,cache_key'}));
    await Promise.all(persisted);
    return json({ok:true,conversationId,question,answer,plan,query:queryResult.spec,data:queryResult.data,warning:queryResult.warning||null,visualization})}catch(error:any){return errorResponse(error,error.status||500)}
}};
