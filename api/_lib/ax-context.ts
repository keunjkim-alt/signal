import {normalizeQuerySpec} from './semantic.js';

export type AxContextFilterKey='country'|'channel'|'platform'|'location'|'product';
export type AxConversationContext={
  version:number;
  pageKey:string;
  intent:string|null;
  metric:string|null;
  dimension:string|null;
  visualization:string|null;
  periodDays:number|null;
  comparison:string|null;
  filters:Record<AxContextFilterKey,string|null>;
  subjects:Array<{type:string;key:string;label?:string}>;
  lastQuerySpec:any;
  lastResultSummary:{rowCount:number;topKeys:string[];watermark:string|null}|null;
  pendingAction:any;
  summary:string;
};

export const EMPTY_AX_FILTERS:Record<AxContextFilterKey,string|null>={country:null,channel:null,platform:null,location:null,product:null};
const CONTINUATION_TOKENS=['그중','그 중','그거','그것','같은','이전','방금','거기','여기서','이어서','그리고','그러면','그대로','이대로','만 보여','만 알려','바꿔'];
const CHANNELS=['자사몰','무신사','29cm','네이버','네이버스토어','w컨셉','wconcept','매장 pos'];
const LOCATIONS=['서울','경기','부산','대구','인천','광주','대전','울산','제주','강남','성수','한남','홍대','명동','판교','상하이','베이징','도쿄'];

const text=(value:any,max=400)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const nullable=(value:any)=>{const valueText=text(value,120);return valueText&&!["전체","all","null"].includes(valueText.toLowerCase())?valueText:null};
const unique=(values:string[])=>[...new Set(values.filter(Boolean))];

export function emptyAxContext(pageKey='hub'):AxConversationContext{return {version:1,pageKey,intent:null,metric:null,dimension:null,visualization:null,periodDays:null,comparison:null,filters:{...EMPTY_AX_FILTERS},subjects:[],lastQuerySpec:null,lastResultSummary:null,pendingAction:null,summary:''}}

export function sanitizeAxContext(input:any,pageKey='hub'):AxConversationContext{
  const base=emptyAxContext(pageKey),filters=input?.filters||{};
  return {...base,...(input&&typeof input==='object'?input:{}),version:Math.max(1,Number(input?.version)||1),pageKey:text(input?.pageKey||pageKey,80)||pageKey,metric:nullable(input?.metric),dimension:nullable(input?.dimension),visualization:nullable(input?.visualization),periodDays:Number(input?.periodDays)>0?Math.min(366,Math.floor(Number(input.periodDays))):null,comparison:nullable(input?.comparison),filters:{country:nullable(filters.country),channel:nullable(filters.channel),platform:nullable(filters.platform),location:nullable(filters.location),product:nullable(filters.product)},subjects:Array.isArray(input?.subjects)?input.subjects.slice(0,10).map((row:any)=>({type:text(row?.type,40),key:text(row?.key,120),...(row?.label?{label:text(row.label,160)}:{})})).filter((row:any)=>row.type&&row.key):[],summary:text(input?.summary,1200)};
}

function explicitPeriod(question:string){
  const day=question.match(/(?:최근\s*)?(\d{1,3})\s*일/);if(day)return Math.min(366,Math.max(1,Number(day[1])));
  const week=question.match(/(?:최근\s*)?(\d{1,2})\s*주/);if(week)return Math.min(366,Math.max(1,Number(week[1])*7));
  const month=question.match(/(?:최근\s*)?(\d{1,2})\s*(?:개월|달)/);if(month)return Math.min(366,Math.max(1,Number(month[1])*31));
  if(/오늘/.test(question))return 1;if(/이번\s*주|지난\s*주|한\s*주/.test(question))return 7;if(/이번\s*달|지난\s*달|한\s*달/.test(question))return 31;return null;
}

function explicitMetric(question:string){
  if(/판매\s*수량|판매량|수량/.test(question))return 'quantity';
  if(/가용\s*재고|재고/.test(question))return 'available_qty';
  if(/반품률|반품/.test(question))return 'return_rate';
  if(/판매율|소진율/.test(question))return 'sell_through_rate';
  if(/기여\s*이익|이익|수익|마진/.test(question))return 'contribution_margin';
  if(/주문\s*수|주문건/.test(question))return 'orders';
  if(/매출|판매/.test(question))return 'net_sales';
  if(/노출/.test(question))return 'exposure_score';if(/순위|랭킹/.test(question))return 'best_rank';if(/평점/.test(question))return 'avg_rating';if(/리뷰\s*수/.test(question))return 'total_review_count';
  return null;
}

function explicitDimension(question:string){
  if(/일별|날짜별|시간대|추이/.test(question))return 'day';
  if(/채널별|플랫폼별/.test(question))return /플랫폼별/.test(question)?'platform':'channel';
  if(/매장(?:별|만)|지역(?:별|만)|위치(?:별|만)/.test(question))return 'location';
  if(/제품별|상품별|sku별/i.test(question))return 'product';
  if(/브랜드별/.test(question))return 'brand';if(/카테고리별|스타일별/.test(question))return 'category';
  return null;
}

function explicitVisualization(question:string){if(/표로|테이블/.test(question))return 'table';if(/추이|선\s*그래프/.test(question))return 'line';if(/히트맵/.test(question))return 'heatmap';if(/사분면/.test(question))return 'quadrant';if(/버블/.test(question))return 'bubble';if(/그래프|차트|막대/.test(question))return 'bar';return null}

function explicitFilters(question:string){
  const lower=question.toLowerCase(),filters:{[K in AxContextFilterKey]?:string|null}={};
  if(/전체\s*국가/.test(lower))filters.country=null;else if(/한국|국내/.test(lower))filters.country='KR';else if(/중국/.test(lower))filters.country='CN';else if(/일본/.test(lower))filters.country='JP';
  if(/전체\s*채널/.test(lower))filters.channel=null;else{const found=CHANNELS.find(channel=>lower.includes(channel));if(found)filters.channel=found==='29cm'?'29CM':found==='wconcept'?'W컨셉':found==='네이버스토어'?'네이버':found==='매장 pos'?'매장 POS':found}
  if(/전체\s*(?:매장|지역|위치)/.test(lower))filters.location=null;else{const found=LOCATIONS.find(location=>lower.includes(location));if(found)filters.location=found}
  if(/전체\s*(?:제품|상품)/.test(lower))filters.product=null;else{const code=question.match(/\b[A-Z]{2,}[A-Z0-9]*-\d{2}(?:-[A-Z0-9]+)*\b/i);if(code)filters.product=code[0].toUpperCase()}
  return filters;
}

function resetFields(question:string){const result=new Set<string>();if(/조건\s*초기화|처음부터|모두\s*초기화/.test(question))result.add('all');if(/기간\s*초기화/.test(question))result.add('periodDays');if(/제품\s*초기화|상품\s*초기화/.test(question))result.add('product');if(/지역\s*초기화|매장\s*초기화/.test(question))result.add('location');if(/채널\s*초기화/.test(question))result.add('channel');return result}

export function isContextContinuation(question:string,previous:any){const clean=text(question);if(!previous||!sanitizeAxContext(previous).metric)return false;return CONTINUATION_TOKENS.some(token=>clean.includes(token))||clean.length<=14}

export function inheritedIntelligenceMode(currentMode:string|null,question:string,previousInput:any){
  if(currentMode)return currentMode;
  const previous=sanitizeAxContext(previousInput),metric=String(previous.metric||''),mode=metric==='review_signal'?'review':metric;
  return isContextContinuation(question,previous)&&['production','discount','forecast','matching','review','customer','returns'].includes(mode)?mode:null;
}

export function modelConversationContext(previous:any,messages:any[]=[]){const context=sanitizeAxContext(previous),recent=(Array.isArray(messages)?messages:[]).slice(-8).map(row=>({role:row?.role==='assistant'?'assistant':'user',content:text(row?.content)}));return {summary:context.summary,metric:context.metric,dimension:context.dimension,visualization:context.visualization,periodDays:context.periodDays,comparison:context.comparison,filters:context.filters,subjects:context.subjects,lastResultSummary:context.lastResultSummary,recentMessages:recent}}

export function resolveAxContextPlan(input:{previous?:any;question:string;page:string;filters?:any;plan:any}){
  const previous=sanitizeAxContext(input.previous,input.page),question=text(input.question,1000),resets=resetFields(question),resetAll=resets.has('all'),continuation=!resetAll&&isContextContinuation(question,previous),metric=explicitMetric(question),dimension=explicitDimension(question),periodDays=explicitPeriod(question),visualization=explicitVisualization(question),questionFilters=explicitFilters(question),pageFilters=normalizeAxFilters(input.filters),planned=normalizeQuerySpec(input.plan),specialMetric=['production','discount','forecast','matching','review_signal','customer','returns'].includes(String(input.plan?.metric))?String(input.plan.metric):null,specialDimension=String(input.plan?.dimension)==='production_order'?'production_order':null,canInherit=continuation||input.plan?.source==='openai';
  if(specialMetric)planned.metric=specialMetric;if(specialDimension)planned.dimension=specialDimension;
  const resolved:any={...input.plan,...planned,metric:metric||((canInherit&&!resets.has('metric'))?previous.metric:null)||planned.metric,dimension:dimension||((canInherit&&!resets.has('dimension'))?previous.dimension:null)||planned.dimension,visualization:visualization||((canInherit&&!resets.has('visualization'))?previous.visualization:null)||planned.visualization,periodDays:periodDays||((canInherit&&!resets.has('periodDays'))?previous.periodDays:null)||planned.periodDays};
  const priorFilters=canInherit&&!resetAll?previous.filters:{...EMPTY_AX_FILTERS},planFilters=normalizeAxFilters(input.plan?.filters),filters:{[K in AxContextFilterKey]:string|null}={...priorFilters};
  for(const key of Object.keys(EMPTY_AX_FILTERS) as AxContextFilterKey[]){if(resets.has(key))filters[key]=null;if(planFilters[key]!=null)filters[key]=planFilters[key];if(pageFilters[key]!=null)filters[key]=pageFilters[key];if(Object.prototype.hasOwnProperty.call(questionFilters,key))filters[key]=questionFilters[key]??null}
  resolved.filters=filters;
  const inherited:string[]=[];if(canInherit&&!resetAll){if(!metric&&previous.metric&&resolved.metric===previous.metric)inherited.push('metric');if(!dimension&&previous.dimension&&resolved.dimension===previous.dimension)inherited.push('dimension');if(!periodDays&&previous.periodDays&&resolved.periodDays===previous.periodDays)inherited.push('periodDays');for(const key of Object.keys(EMPTY_AX_FILTERS) as AxContextFilterKey[])if(!Object.prototype.hasOwnProperty.call(questionFilters,key)&&pageFilters[key]==null&&previous.filters[key]!=null&&filters[key]===previous.filters[key])inherited.push(key)}
  const context:AxConversationContext={...previous,version:previous.version+1,pageKey:input.page,intent:text(input.plan?.title||input.plan?.metric,120)||null,metric:resolved.metric,dimension:resolved.dimension,visualization:resolved.visualization,periodDays:resolved.periodDays,comparison:/전년|지난해/.test(question)?'previous_year':/지난달|이전\s*달/.test(question)?'previous_period':resetAll?null:previous.comparison,filters,subjects:filters.product?[{type:'product',key:filters.product}]:canInherit?previous.subjects:[],lastQuerySpec:resolved,summary:''};
  context.summary=summarizeAxContext(context);
  const changes=contextChanges(previous,context,resetAll);
  return {plan:resolved,context,changes,inherited:unique(inherited),reset:resetAll,continuation};
}

export function finalizeAxContext(contextInput:any,data:any={},watermark:string|null=null){const context=sanitizeAxContext(contextInput),rows=Array.isArray(data?.rows)?data.rows:[],topKeys=unique(rows.slice(0,10).map((row:any)=>text(row.product_code||row.dimension||row.label||row.id,120))).slice(0,10);return {...context,lastResultSummary:{rowCount:rows.length,topKeys,watermark},summary:summarizeAxContext(context)}}

export function removeAxContextField(contextInput:any,field:string){const context=sanitizeAxContext(contextInput);if(field==='all')return emptyAxContext(context.pageKey);if(['metric','dimension','visualization','periodDays','comparison','pendingAction'].includes(field))(context as any)[field]=null;else if(Object.prototype.hasOwnProperty.call(context.filters,field))context.filters[field as AxContextFilterKey]=null;if(field==='product')context.subjects=[];context.version+=1;context.summary=summarizeAxContext(context);return context}

export function summarizeAxContext(contextInput:any){const context=sanitizeAxContext(contextInput),parts:string[]=[];if(context.periodDays)parts.push(`최근 ${context.periodDays}일`);if(context.metric)parts.push(metricLabel(context.metric));if(context.dimension)parts.push(`${dimensionLabel(context.dimension)}별`);if(context.filters.country)parts.push(context.filters.country);if(context.filters.channel)parts.push(context.filters.channel);if(context.filters.location)parts.push(context.filters.location);if(context.filters.product)parts.push(context.filters.product);if(context.comparison==='previous_year')parts.push('전년 동기 비교');else if(context.comparison==='previous_period')parts.push('이전 기간 비교');return parts.join(' · ').slice(0,1200)}

export function normalizeAxFilters(input:any={}){const normalized=normalizeQuerySpec({filters:input}).filters;return {...EMPTY_AX_FILTERS,...normalized,location:nullable(input?.location),product:nullable(input?.product)} as Record<AxContextFilterKey,string|null>}

function contextChanges(previousInput:any,next:AxConversationContext,resetAll=false){const previous=sanitizeAxContext(previousInput,next.pageKey),changes:any[]=[];if(resetAll)return [{field:'all',from:previous.summary||null,to:null,source:'user'}];for(const field of ['metric','dimension','visualization','periodDays','comparison'])if((previous as any)[field]!==((next as any)[field]))changes.push({field,from:(previous as any)[field]??null,to:(next as any)[field]??null,source:'user'});for(const field of Object.keys(EMPTY_AX_FILTERS) as AxContextFilterKey[])if(previous.filters[field]!==next.filters[field])changes.push({field,from:previous.filters[field],to:next.filters[field],source:'user'});return changes}
function metricLabel(value:string){return ({net_sales:'순매출',quantity:'판매수량',orders:'주문수',available_qty:'가용재고',inventory_cover_days:'재고커버',contribution_margin:'기여이익',return_rate:'반품률',sell_through_rate:'판매율',exposure_score:'노출도',best_rank:'순위',avg_rating:'평점',total_review_count:'리뷰 수'} as Record<string,string>)[value]||value}
function dimensionLabel(value:string){return ({day:'일',channel:'채널',location:'매장·지역',product:'제품',brand:'브랜드',platform:'플랫폼',category:'카테고리',market_product:'외부상품'} as Record<string,string>)[value]||value}
