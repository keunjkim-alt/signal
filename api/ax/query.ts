import {createHash} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {bodyJson,errorResponse,json} from '../_lib/http.js';
import {emptyAxContext,finalizeAxContext,inheritedIntelligenceMode,modelConversationContext,removeAxContextField,resolveAxContextPlan,sanitizeAxContext} from '../_lib/ax-context.js';
import {createAnalysisPlan} from '../_lib/openai.js';
import {intelligenceMode,requiresOpenAI} from '../_lib/semantic.js';
import {audit,insert,requestContext,requirePagePermission,supabase,update,workspaceId} from '../_lib/supabase.js';
import {customerReturnInsights,productionWorkflow,reviewInsights,runDashboardQuery} from '../dashboards/query.js';

const allowedActions=['approved','adjustment_requested','review_requested','held'];
const stable=(value:any):string=>value&&typeof value==='object'?(Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`):JSON.stringify(value);
const normalizeQuestion=(value:string)=>value.toLowerCase().replace(/\s+/g,' ').trim();
const watermarkMemory=new Map<string,{value:string|null;expiresAt:number}>();
async function latestWatermark(org:string,workspace:string|null){
  const memoryKey=`${org}:${workspace||'all'}`,memory=watermarkMemory.get(memoryKey);
  if(memory&&memory.expiresAt>Date.now())return memory.value;
  const sourceQuery=new URLSearchParams({organization_id:`eq.${org}`,select:'last_synced_at',order:'last_synced_at.desc.nullslast',limit:'1'});if(workspace)sourceQuery.set('workspace_id',`eq.${workspace}`);
  const source=await supabase(`/rest/v1/data_sources?${sourceQuery}`,{serviceRole:true});
  const value=source.data?.[0]?.last_synced_at||null;
  watermarkMemory.set(memoryKey,{value,expiresAt:Date.now()+30_000});
  return value;
}
async function cachedPlan(org:string,workspace:string|null,key:string){const query=new URLSearchParams({organization_id:`eq.${org}`,cache_key:`eq.${key}`,expires_at:`gt.${new Date().toISOString()}`,select:'id,plan_spec,result_spec,model,hit_count',limit:'1'});if(workspace)query.set('workspace_id',`eq.${workspace}`);return ((await supabase(`/rest/v1/ax_query_cache?${query}`,{serviceRole:true})).data||[])[0]||null}
function rowsForRequestedProduct(rows:any[],question:string){
  const compactQuestion=normalizeQuestion(question).replace(/\s+/g,'');
  const matching=rows.filter(row=>[row?.product_code,row?.product_name].some(value=>{
    const candidate=String(value||'').toLowerCase().replace(/\s+/g,'');
    return candidate.length>=4&&compactQuestion.includes(candidate);
  }));
  return matching.length?matching:rows;
}
async function productIntelligence(context:any,page:string,mode:'matching'|'forecast'|'discount'|'review'|'customer'|'returns'|'production',question=''){
  if(mode==='production'){
    const data=await productionWorkflow(context);
    const rows=(data.orders||[]).map((row:any)=>({...row,label:`${row.production_order_no||'생산오더'} · ${row.product_code||'상품'}`,production:Number(row.progress||0)}));
    return {spec:{source:'precomputed_operational_workflow',mode,visualization:'table'},data:{rows,summary:data.summary,integrity:data.integrity,source:'precomputed_operational_workflow',note:'승인된 재주문과 실제 생산 공정·입고 목표를 조회했습니다.'}};
  }
  if(mode==='customer'||mode==='returns'){
    const data=await customerReturnInsights(context),insight:any=mode==='customer'?data.customer:data.returns;
    const rows=mode==='customer'?insight.regions||[]:insight.products||[];
    return {spec:{source:'precomputed_operational_insight',mode,visualization:mode==='customer'?'table':'bar'},data:{rows,summary:insight.summary,profileCoverage:insight.profileCoverage||null,reasonCoverage:insight.reasonCoverage||null,source:'precomputed_operational_insight',note:mode==='customer'?'익명 고객 토큰과 시군구 배송지역만 집계했습니다.':'주문·반품 수량·취소 상태에서 계산했습니다.'}};
  }
  if(mode==='review'){
    const insight=await reviewInsights(context),rows=rowsForRequestedProduct(insight.products||[],question);
    return {spec:{source:'precomputed_review_signals',mode,visualization:'table'},data:{rows,summary:insight.summary,aspects:insight.aspects,evidence:insight.evidence,actions:insight.actions,source:'precomputed_review_signals',note:'업로드 시 저장한 속성·감정 분류와 근거 리뷰를 조회했습니다.'}};
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

async function resolveConversationId(context:any,body:any,page:string,org:string){
  const ws=workspaceId(context);
  const requested=String(body?.conversationId||'');
  if(requested){const check=new URLSearchParams({id:`eq.${requested}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`,select:'id'});if(ws)check.set('workspace_id',`eq.${ws}`);if(!((await supabase(`/rest/v1/ax_conversations?${check}`,{token:context.accessToken})).data||[]).length)throw Object.assign(new Error('Conversation not found'),{status:404});return requested}
  const created=(await insert('ax_conversations',{organization_id:org,workspace_id:ws,user_id:context.user.id,title:String(body?.question||'').slice(0,80),page_key:page,status:'active'}))?.[0];
  return created.id;
}

async function loadConversationState(context:any,conversationId:string,org:string,ws:string|null){
  const contextQuery=new URLSearchParams({organization_id:`eq.${org}`,conversation_id:`eq.${conversationId}`,user_id:`eq.${context.user.id}`,select:'context_state,context_summary,context_version,updated_at',limit:'1'}),messageQuery=new URLSearchParams({organization_id:`eq.${org}`,conversation_id:`eq.${conversationId}`,select:'role,content,page_key,created_at',order:'created_at.desc',limit:'8'});
  if(ws){contextQuery.set('workspace_id',`eq.${ws}`);messageQuery.set('workspace_id',`eq.${ws}`)}
  const [stored,messages]=await Promise.all([supabase(`/rest/v1/ax_conversation_contexts?${contextQuery}`,{serviceRole:true}).then(result=>result.data||[]),supabase(`/rest/v1/ax_messages?${messageQuery}`,{serviceRole:true}).then(result=>result.data||[])]);
  return {context:sanitizeAxContext(stored[0]?.context_state),messages:messages.reverse()};
}

async function prepareConversationState(context:any,body:any,page:string,org:string,ws:string|null){
  const requested=String(body?.conversationId||'');
  if(!requested){
    const created=(await insert('ax_conversations',{organization_id:org,workspace_id:ws,user_id:context.user.id,title:String(body?.question||'').slice(0,80),page_key:page,status:'active'}))?.[0];
    return {conversationId:created.id,state:{context:sanitizeAxContext(null),messages:[]}};
  }
  const check=new URLSearchParams({id:`eq.${requested}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`,select:'id'});if(ws)check.set('workspace_id',`eq.${ws}`);
  const [owned,state]=await Promise.all([
    supabase(`/rest/v1/ax_conversations?${check}`,{token:context.accessToken}).then(result=>result.data||[]),
    loadConversationState(context,requested,org,ws)
  ]);
  if(!owned.length)throw Object.assign(new Error('Conversation not found'),{status:404});
  return {conversationId:requested,state};
}

async function saveConversationContext(context:any,conversationId:string,state:any,org:string,ws:string|null){
  const normalized=sanitizeAxContext(state);
  return insert('ax_conversation_contexts',{organization_id:org,workspace_id:ws,conversation_id:conversationId,user_id:context.user.id,context_state:normalized,context_summary:normalized.summary||null,context_version:normalized.version,updated_at:new Date().toISOString()},{upsert:true,onConflict:'conversation_id'});
}

async function updateConversationContext(context:any,body:any,page:string,org:string,ws:string|null){
  requirePagePermission(context,page,'view');
  const conversationId=String(body?.conversationId||'');if(!conversationId)return json({ok:false,error:'conversationId is required'},400);
  await resolveConversationId(context,{conversationId},page,org);
  const current=await loadConversationState(context,conversationId,org,ws),field=body?.contextAction==='reset'?'all':String(body?.field||'');
  if(!['all','metric','dimension','visualization','periodDays','comparison','country','channel','platform','location','product'].includes(field))return json({ok:false,error:'Valid context field is required'},400);
  const next=removeAxContextField(current.context,field);await saveConversationContext(context,conversationId,next,org,ws);await audit(context,'ax.context_updated','ax_conversation',conversationId,{field,workspaceId:ws});
  return json({ok:true,conversationId,resolvedContext:next});
}

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  const requestStarted=performance.now();
  try{const body=await bodyJson(request),page=String(body?.page||'hub'),context=await requestContext(request,{includeProfile:false,includeBrands:false,permissionPage:page}),org=context.membership.organization_id,ws=workspaceId(context),contextReady=performance.now();
    if(body?.contextAction)return updateConversationContext(context,body,page,org,ws);
    if(body?.action){const conversationId=String(body?.conversationId||''),action=String(body.action||'');if(!conversationId||!allowedActions.includes(action))return json({ok:false,error:'Valid conversationId and action are required'},400);requirePagePermission(context,page,action==='approved'?'approve':'update');const conversationQuery=new URLSearchParams({id:`eq.${conversationId}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`,select:'id'});if(ws)conversationQuery.set('workspace_id',`eq.${ws}`);const conversation=((await supabase(`/rest/v1/ax_conversations?${conversationQuery}`,{serviceRole:true})).data||[])[0];if(!conversation)return json({ok:false,error:'Conversation not found'},404);const recommendationKey=String(body?.recommendationKey||`${page}:primary`).slice(0,120),now=new Date().toISOString();const recommendation=(await insert('ax_recommendations',{organization_id:org,workspace_id:ws,conversation_id:conversationId,recommendation_key:recommendationKey,page_key:page,title:String(body?.title||'AX 추천 실행안').slice(0,180),status:action,payload:body?.payload||{},created_by:context.user.id,updated_at:now,approved_by:action==='approved'?context.user.id:null,approved_at:action==='approved'?now:null},{upsert:true,onConflict:'organization_id,conversation_id,recommendation_key'}))?.[0];await insert('ax_action_events',{organization_id:org,workspace_id:ws,recommendation_id:recommendation.id,conversation_id:conversationId,actor_user_id:context.user.id,action,payload:body?.payload||{}});await audit(context,`ax.${action}`,'ax_recommendation',recommendation.id,{conversationId,page,recommendationKey,workspaceId:ws});return json({ok:true,recommendation})}
    requirePagePermission(context,page,'view');const question=String(body?.question||'').trim();if(!question)return json({ok:false,error:'question is required'},400);
    const planStarted=performance.now(),filters=body?.filters||{},[prepared,watermark]=await Promise.all([prepareConversationState(context,body,page,org,ws),latestWatermark(org,ws)]),conversationId=prepared.conversationId,conversationState=prepared.state,mode=inheritedIntelligenceMode(intelligenceMode(question,page),question,conversationState.context),normalized=normalizeQuestion(question),modelContext=modelConversationContext(conversationState.context,conversationState.messages),useModel=!mode&&requiresOpenAI(question),contextFingerprint=stable({version:conversationState.context.version,summary:conversationState.context.summary,filters:conversationState.context.filters,subjects:conversationState.context.subjects}),useCache=useModel,cacheKey=useCache?createHash('sha256').update(stable({cacheVersion:'intelligence-v7',workspaceId:ws,page,question:normalized,filters,contextFingerprint,watermark})).digest('hex'):'';let cache=useCache?await cachedPlan(org,ws,cacheKey):null,plan:any,cacheTouch:Promise<any>|null=null;
    if(cache){plan={...cache.plan_spec,source:'cache',model:cache.model||null};cacheTouch=update('ax_query_cache',{id:`eq.${cache.id}`},{hit_count:Number(cache.hit_count||0)+1,updated_at:new Date().toISOString()})}else if(mode==='production')plan={metric:'production',dimension:'production_order',visualization:'table',periodDays:28,filters,title:'생산오더 납기·공정 실행 현황',explanation:'승인된 재주문에서 생성된 실제 생산오더와 현재 공정·납기 위험을 조회했습니다.',source:'precomputed_operational_workflow',model:null};else if(mode==='discount')plan={metric:'discount',dimension:'product',visualization:'curve',periodDays:14,filters,title:'상품·채널별 최적 할인 추천',explanation:'저장된 가격 탄력성·기여이익·재고 위험 시나리오에서 최적 할인값을 조회했습니다.',source:'precomputed_intelligence',model:null};else if(mode==='forecast')plan={metric:'forecast',dimension:'product',visualization:'bar',periodDays:14,filters,title:'제품별 14일 수요예측과 재고 커버',explanation:'저장된 판매속도·재고 스냅샷에서 예측 판매량과 재주문 필요 수량을 조회했습니다.',source:'precomputed_intelligence',model:null};else if(mode==='matching')plan={metric:'matching',dimension:'product',visualization:'table',periodDays:1,filters,title:'자사 상품과 외부 경쟁 상품 매칭',explanation:'스타일·가격·순위·리뷰 특징으로 미리 계산한 매칭 추천을 조회했습니다.',source:'precomputed_intelligence',model:null};else if(mode==='review')plan={metric:'review_signal',dimension:'product',visualization:'table',periodDays:90,filters,title:'상품별 리뷰·VOC 위험 신호',explanation:'업로드 시 저장한 리뷰 속성·감정·반품 위험 신호를 조회했습니다.',source:'precomputed_review_signals',model:null};else if(mode==='customer')plan={metric:'customer',dimension:'location',visualization:'table',periodDays:90,filters,title:'고객·지역 재구매 신호',explanation:'저장된 익명 고객 토큰과 시군구 배송지역 집계를 조회했습니다.',source:'precomputed_operational_insight',model:null};else if(mode==='returns')plan={metric:'returns',dimension:'product',visualization:'bar',periodDays:90,filters,title:'반품·취소 위험 신호',explanation:'저장된 주문·반품 수량·취소 상태에서 제품별 위험을 조회했습니다.',source:'precomputed_operational_insight',model:null};else plan=await createAnalysisPlan(question,page,filters,{useModel,conversationContext:modelContext,recentMessages:modelContext.recentMessages});
    const resolution=resolveAxContextPlan({previous:conversationState.context,question,page,filters,plan}),resolvedPlan=resolution.plan,planReady=performance.now(),queryTask=(async()=>{try{return cache?.result_spec?cache.result_spec:mode?await productIntelligence(context,page,mode,`${question} ${resolvedPlan.filters?.product||''}`):await runDashboardQuery(context,{...resolvedPlan,page})}catch(error:any){return {spec:resolvedPlan,data:{rows:[]},warning:error.message}}})(),queryResult=await queryTask,queryReady=performance.now(),finalContext=finalizeAxContext(resolution.context,queryResult.data,watermark);
    const modeDimension=mode==='customer'?'location':mode==='production'?'production_order':mode?'product':resolvedPlan.dimension,runtimeWarning=queryResult.warning||resolvedPlan.warning||null,visualization={type:['matching','review','customer','production'].includes(String(mode))?'table':mode==='forecast'||mode==='returns'?'bar':mode==='discount'?'curve':resolvedPlan.visualization,title:resolvedPlan.title,explanation:resolvedPlan.explanation,metric:mode||resolvedPlan.metric,dimension:modeDimension,rows:queryResult.data?.rows||[]},inheritance=resolution.inherited.length?` 이전 분석의 ${resolution.inherited.join(', ')} 조건을 이어받았습니다.`:'',answer=queryResult.warning?`${resolvedPlan.explanation}${inheritance} 현재 조건에서는 일부 데이터 조회가 제한되었습니다.`:`${resolvedPlan.explanation}${inheritance} ${visualization.rows.length}개 결과를 현재 권한 범위에서 조회했습니다.${queryResult.data?.note?` ${queryResult.data.note}`:''}`;
    const userCreatedAt=new Date().toISOString(),assistantCreatedAt=new Date(Date.now()+1).toISOString(),conversationFilter:any={id:`eq.${conversationId}`,organization_id:`eq.${org}`,user_id:`eq.${context.user.id}`};if(ws)conversationFilter.workspace_id=`eq.${ws}`;await saveConversationContext(context,conversationId,finalContext,org,ws);const persisted=[insert('ax_messages',{organization_id:org,workspace_id:ws,conversation_id:conversationId,user_id:context.user.id,role:'user',content:question,page_key:page,source:'user',created_at:userCreatedAt}),insert('ax_messages',{organization_id:org,workspace_id:ws,conversation_id:conversationId,user_id:context.user.id,role:'assistant',content:answer,page_key:page,query_spec:{...queryResult.spec,resolvedContext:finalContext,contextChanges:resolution.changes,inherited:resolution.inherited},visualization_spec:visualization,model:resolvedPlan.model||null,source:resolvedPlan.source||'heuristic',created_at:assistantCreatedAt}),update('ax_conversations',conversationFilter,{page_key:page,last_message_at:assistantCreatedAt,updated_at:assistantCreatedAt})];
    if(cacheTouch)persisted.push(cacheTouch);
    if(useCache&&!cache)persisted.push(insert('ax_query_cache',{organization_id:org,workspace_id:ws,cache_key:cacheKey,page_key:page,question_normalized:normalized,filters:resolvedPlan.filters,plan_spec:resolvedPlan,result_spec:queryResult,data_watermark:watermark,model:resolvedPlan.model||null,token_usage:resolvedPlan.usage||null,expires_at:new Date(Date.now()+15*60*1000).toISOString()},{upsert:true,onConflict:'organization_id,cache_key'}));
    if(resolvedPlan.degraded)persisted.push(audit(context,'ax.router_fallback','ax_conversation',conversationId,{page,warningCode:resolvedPlan.warningCode||'AX_DEGRADED',source:resolvedPlan.source}));
    waitUntil(Promise.all(persisted).then(()=>undefined).catch(error=>console.error('[AX persistence]',error?.message||error)));const completed=performance.now(),timing={totalMs:Math.round(completed-requestStarted),contextMs:Math.round(contextReady-requestStarted),planMs:Math.round(planReady-planStarted),queryMs:Math.round(queryReady-planReady),persistQueued:true,route:resolvedPlan.source||'heuristic',cacheHit:Boolean(cache)};
    return json({ok:true,conversationId,question,answer,plan:resolvedPlan,query:queryResult.spec,data:queryResult.data,warning:runtimeWarning,visualization,resolvedContext:finalContext,contextChanges:resolution.changes,inherited:resolution.inherited,continuation:resolution.continuation,timing},200,{'server-timing':`context;dur=${timing.contextMs}, plan;dur=${timing.planMs}, query;dur=${timing.queryMs}`})}catch(error:any){return errorResponse(error,error.status||500)}
}};
