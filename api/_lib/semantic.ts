export const SALES_METRICS=['net_sales','quantity','orders','available_qty','inventory_cover_days','contribution_margin','return_rate','sell_through_rate'];
export const MARKET_METRICS=['exposure_score','best_rank','avg_rank','product_count','top_100_count','avg_discount_rate','avg_rating','total_review_count'];
export const METRICS=[...SALES_METRICS,...MARKET_METRICS];
export const SALES_DIMENSIONS=['day','channel','location','product'];
export const MARKET_DIMENSIONS=['brand','platform','category','market_product'];
export const DIMENSIONS=[...SALES_DIMENSIONS,...MARKET_DIMENSIONS];
export const VISUALIZATIONS=['kpi','bar','line','area','table','heatmap','quadrant','bubble','timeline','rank'];

export function normalizeQuerySpec(input:any={}){
  const metric=METRICS.includes(input.metric)?input.metric:'net_sales';
  const dimension=DIMENSIONS.includes(input.dimension)?input.dimension:'channel';
  const visualization=VISUALIZATIONS.includes(input.visualization)?input.visualization:(dimension==='day'?'line':'bar');
  const periodDays=Math.min(366,Math.max(1,Number(input.periodDays)||7));
  return {metric,dimension,visualization,periodDays,filters:{country:clean(input.filters?.country),channel:clean(input.filters?.channel),platform:clean(input.filters?.platform)},limit:Math.min(100,Math.max(1,Number(input.limit)||20))};
}

function clean(value:any){if(typeof value!=='string'||!value.trim()||value==='전체 국가'||value==='전체 채널')return null;return ({'한국':'KR','중국':'CN','일본':'JP'} as Record<string,string>)[value.trim()]||value.trim()}

export function heuristicPlan(question:string,page='hub'){
  const text=`${page} ${question}`.toLowerCase();
  const marketText=text.replace(/우선\s*순위/g,'');
  const isMarket=['market','radar','마켓','시장','경쟁','외부','노출','랭킹','순위','리뷰','평점'].some(token=>marketText.includes(token));
  const dimension=isMarket?(text.includes('일별')||text.includes('추이')?'day':text.includes('플랫폼')?'platform':text.includes('카테고리')||text.includes('스타일')?'category':text.includes('제품')||text.includes('상품')?'market_product':'brand'):(text.includes('매장')||text.includes('지역')?'location':text.includes('제품')||text.includes('sku')||text.includes('재고')?'product':text.includes('일별')||text.includes('추이')||text.includes('시간')?'day':'channel');
  const metric=isMarket?(text.includes('리뷰')?'total_review_count':text.includes('평점')?'avg_rating':text.includes('할인')?'avg_discount_rate':text.includes('상품 수')||text.includes('제품 수')?'product_count':text.includes('top')||text.includes('상위')?'top_100_count':text.includes('순위')||text.includes('랭킹')?'best_rank':'exposure_score'):(text.includes('재고')?'available_qty':text.includes('수량')?'quantity':text.includes('반품')?'return_rate':text.includes('이익')||text.includes('수익')?'contribution_margin':'net_sales');
  const visualization=text.includes('표')?'table':text.includes('추이')?'line':text.includes('재고')&&text.includes('판매')?'quadrant':dimension==='day'?'area':'bar';
  return normalizeQuerySpec({metric,dimension,visualization,periodDays:text.includes('월')?31:text.includes('주')?7:14});
}

export function requiresOpenAI(question:string){
  const text=question.toLowerCase();
  return ['왜','원인','전략','시나리오','어떻게','설명해','비교해서 판단'].some(token=>text.includes(token));
}

export function intelligenceMode(question:string,page='hub'):'matching'|'forecast'|'discount'|'review'|'customer'|'returns'|'production'|null{
  const text=`${page} ${question}`.toLowerCase();
  if(page==='production'||['생산오더','생산 오더','생산 큐','공정','납기','검품','불량','봉제','재단'].some(token=>text.includes(token)))return 'production';
  if(['리뷰','후기','평점','voc','고객의견','부정 리뷰'].some(token=>text.includes(token)))return 'review';
  if(page==='returns'||['반품','취소','환불'].some(token=>text.includes(token)))return 'returns';
  if(page==='customers'||['재구매','고객군','고객 세그먼트','배송지역','구매주기'].some(token=>text.includes(token)))return 'customer';
  if((page==='profitability'||text.includes('할인'))&&['최적','권장','추천','할인율','정상가','가격','마진','이익'].some(token=>text.includes(token)))return 'discount';
  if(['자사 상품','경쟁 상품','유사 상품','상품 매칭','제품 매칭','match'].some(token=>text.includes(token)))return 'matching';
  if(['예측','재주문','수요','소진','품절','forecast'].some(token=>text.includes(token)))return 'forecast';
  return null;
}
