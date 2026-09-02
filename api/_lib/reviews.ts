const normalize=(value:any)=>String(value??'').trim().toLowerCase().replace(/[\s._\-/()]+/g,'');

export const REVIEW_FIELDS={
  review_id:['review_id','review_no','review_key','리뷰id','리뷰번호','후기번호'],
  reviewed_at:['reviewed_at','created_at','review_date','작성일시','리뷰작성일','작성일'],
  platform:['platform','marketplace','mall','플랫폼','판매처','몰'],
  channel_code:['channel_code','channel','sales_channel','채널코드','판매채널','채널'],
  product_code:['product_code','style_code','product_id','품번','상품코드','제품코드'],
  sku_code:['sku_code','sku','option_code','단품코드','옵션코드','sku코드'],
  product_name:['product_name','item_name','상품명','제품명'],
  rating:['rating','score','stars','평점','별점'],
  review_text:['review_text','review','content','comment','리뷰내용','후기내용','리뷰','내용'],
  verified_purchase:['verified_purchase','verified','구매인증','실구매'],
  helpful_count:['helpful_count','helpful','likes','도움수','추천수'],
  image_review:['image_review','has_image','photo_review','포토리뷰','사진리뷰'],
  customer_token:['customer_token','customer_id_hash','member_token','익명고객id','고객토큰'],
  order_id:['order_id','order_no','주문번호'],
  country_code:['country_code','country','국가코드','국가'],
  color:['color','colour','색상','컬러'],
  size:['size','사이즈','옵션사이즈'],
  seller_response_status:['seller_response_status','response_status','reply_status','답변상태','판매자답변상태']
};

export const REVIEW_REQUIRED_FIELDS=['review_id','reviewed_at','platform','product_code','rating','review_text'];

export const REVIEW_ASPECTS=[
  {code:'fit',label:'사이즈·핏',team:'디자인',positive:['핏이 좋아','잘 맞','편하게 맞','실루엣이 예','체형을 잡'],negative:['작아요','작게 나','커요','크게 나','타이트','끼어요','길어요','짧아요','사이즈가 애매','핏이 이상']},
  {code:'material',label:'소재',team:'생산',positive:['소재가 좋아','원단이 좋아','부드러','촉감이 좋아','가벼워서 좋'],negative:['원단이 얇','소재가 아쉬','까슬','비쳐요','무거워요','통풍이 안']},
  {code:'quality',label:'품질',team:'생산',positive:['마감이 좋아','퀄리티가 좋아','튼튼','봉제가 좋아'],negative:['불량','봉제','실밥','지퍼','단추가 떨어','올이 풀','마감이 아쉬','냄새']},
  {code:'color',label:'색상',team:'디자인',positive:['색상이 예','컬러가 예','색감이 좋아','화면과 같'],negative:['색상이 달라','색감이 달라','물빠짐','변색','생각보다 어두','생각보다 밝']},
  {code:'design',label:'디자인',team:'상품기획',positive:['디자인이 예','스타일이 좋아','세련','코디하기 좋','활용도 높'],negative:['디자인이 아쉬','촌스러','디테일이 아쉬','코디가 어려']},
  {code:'price',label:'가격',team:'상품기획',positive:['가격이 좋아','가성비','가격 대비 만족'],negative:['비싸요','가격이 높','가격 대비 아쉬','할인하면 살']},
  {code:'delivery',label:'배송·포장',team:'CS',positive:['배송이 빨','포장이 깔끔','배송 만족'],negative:['배송이 늦','포장이 훼손','박스가 찌그러','오배송','누락']},
  {code:'usability',label:'활용성',team:'마케팅',positive:['자주 입','활용하기 좋','데일리','코디하기 쉬','손이 자주'],negative:['활용하기 어려','입을 일이 없','코디가 어려','관리하기 어려']}
];

export function inferReviewMapping(headers:string[],requested:any={}){
  const byNormalized=new Map(headers.map(header=>[normalize(header),header])),mapping:any={};
  for(const [canonical,aliases] of Object.entries(REVIEW_FIELDS)){
    const explicit=requested[canonical];if(explicit&&headers.includes(explicit)){mapping[canonical]=explicit;continue}
    const match=(aliases as string[]).map(normalize).find(alias=>byNormalized.has(alias));if(match)mapping[canonical]=byNormalized.get(match);
  }
  return mapping;
}

export function validateAndNormalizeReviews(rows:Record<string,any>[],mapping:any){
  const missingFields=REVIEW_REQUIRED_FIELDS.filter(field=>!mapping[field]);
  if(missingFields.length)return {validRows:[],errors:[],missingFields,period:{start:null,end:null}};
  const validRows:any[]=[],errors:any[]=[];
  rows.forEach((row,index)=>{
    const get=(field:string)=>row[mapping[field]],reviewId=cleanText(get('review_id')),reviewedAt=parseDate(get('reviewed_at')),platform=cleanText(get('platform')),productCode=cleanCode(get('product_code')),rating=Number(get('rating')),reviewText=cleanText(get('review_text'));
    const invalid:string[]=[];if(!reviewId)invalid.push('review_id');if(!reviewedAt)invalid.push('reviewed_at');if(!platform)invalid.push('platform');if(!productCode)invalid.push('product_code');if(!Number.isFinite(rating)||rating<1||rating>5)invalid.push('rating');if(!reviewText)invalid.push('review_text');
    if(invalid.length){errors.push({row_number:index+2,error_code:'INVALID_ROW',field_name:invalid.join(','),message:`필수값 오류: ${invalid.join(', ')}`,raw_row:row});return}
    validRows.push({row_number:index+2,source_review_id:reviewId,reviewed_at:reviewedAt,platform,channel_code:cleanCode(get('channel_code'))||cleanCode(platform),product_code:productCode,sku_code:cleanCode(get('sku_code'))||productCode,product_name:cleanText(get('product_name'))||productCode,rating,review_text:reviewText,verified_purchase:parseBoolean(get('verified_purchase')),helpful_count:Math.max(0,Math.floor(Number(get('helpful_count'))||0)),image_review:parseBoolean(get('image_review')),customer_token:cleanText(get('customer_token')),order_id:cleanText(get('order_id')),country_code:cleanCode(get('country_code'))||'KR',color:cleanText(get('color')),size:cleanText(get('size')),seller_response_status:normalizeResponse(get('seller_response_status')),raw_row:row});
  });
  const timestamps=validRows.map(row=>row.reviewed_at).sort();return {validRows,errors,missingFields:[],period:{start:timestamps[0]||null,end:timestamps.at(-1)||null}};
}

export function classifyReview(row:any){
  const text=String(row.review_text||'').toLowerCase(),rating=Number(row.rating||0),signals:any[]=[];
  for(const aspect of REVIEW_ASPECTS){
    const positive=aspect.positive.some(term=>text.includes(term)),negative=aspect.negative.some(term=>text.includes(term));
    if(!positive&&!negative)continue;
    const sentiment=negative?'negative':positive?'positive':rating<=2?'negative':rating>=4?'positive':'neutral',severity=sentiment==='negative'?(rating<=1?3:rating<=2?2:1):0;
    signals.push({aspect_code:aspect.code,aspect_label:aspect.label,sentiment,severity,confidence:(negative||positive)?0.92:0.7,return_risk:sentiment==='negative'&&['fit','quality','color','material'].includes(aspect.code),recommended_team:aspect.team,recommended_action:recommendedAction(aspect.code,sentiment)});
  }
  if(!signals.length)signals.push({aspect_code:'overall',aspect_label:'전반 만족',sentiment:rating<=2?'negative':rating>=4?'positive':'neutral',severity:rating<=1?3:rating<=2?2:0,confidence:.72,return_risk:rating<=2,recommended_team:rating<=2?'CS':'마케팅',recommended_action:rating<=2?'낮은 평점 리뷰 확인 및 고객 응대':'긍정 리뷰 소재 활용'});
  return signals;
}

export function summarizeReviewInsights(reviews:any[],signals:any[],products:any[]=[]){
  const productMap=new Map(products.map(row=>[String(row.id),row])),byReview=new Map<string,any[]>();for(const signal of signals){const rows=byReview.get(String(signal.review_id))||[];rows.push(signal);byReview.set(String(signal.review_id),rows)}
  const total=reviews.length,negativeReviews=reviews.filter(row=>(byReview.get(String(row.id))||[]).some(signal=>signal.sentiment==='negative')),responseNeeded=negativeReviews.filter(row=>row.seller_response_status!=='responded'),averageRating=total?reviews.reduce((sum,row)=>sum+Number(row.rating||0),0)/total:0;
  const aspectMap=new Map<string,any>(),productAgg=new Map<string,any>(),channelAgg=new Map<string,any>(),daily=new Map<string,any>();
  for(const row of reviews){const product:any=productMap.get(String(row.product_id))||{},rowSignals=byReview.get(String(row.id))||[],date=String(row.reviewed_at||'').slice(0,10),day=daily.get(date)||{date,reviews:0,rating:0,negative:0};day.reviews++;day.rating+=Number(row.rating||0);if(rowSignals.some(signal=>signal.sentiment==='negative'))day.negative++;daily.set(date,day);const pkey=product.product_code||row.product_code||'UNKNOWN',p=productAgg.get(pkey)||{product_code:pkey,product_name:product.product_name||pkey,image_url:product.image_url||null,reviews:0,rating:0,negative:0,topics:{}};p.reviews++;p.rating+=Number(row.rating||0);if(rowSignals.some(signal=>signal.sentiment==='negative'))p.negative++;for(const signal of rowSignals)p.topics[signal.aspect_code]=(p.topics[signal.aspect_code]||0)+(signal.sentiment==='negative'?1:0);productAgg.set(pkey,p);const c=channelAgg.get(row.platform)||{platform:row.platform,reviews:0,rating:0,negative:0};c.reviews++;c.rating+=Number(row.rating||0);if(rowSignals.some(signal=>signal.sentiment==='negative'))c.negative++;channelAgg.set(row.platform,c)}
  for(const signal of signals){const key=signal.aspect_code,a=aspectMap.get(key)||{aspect_code:key,label:signal.aspect_label||REVIEW_ASPECTS.find(item=>item.code===key)?.label||key,total:0,positive:0,neutral:0,negative:0,severity:0,team:signal.recommended_team};a.total++;a[signal.sentiment]=(a[signal.sentiment]||0)+1;a.severity+=Number(signal.severity||0);aspectMap.set(key,a)}
  const finalize=(row:any)=>({...row,average_rating:row.reviews?row.rating/row.reviews:0,negative_pct:row.reviews?row.negative/row.reviews*100:0});
  const evidence=negativeReviews.sort((a,b)=>Number(a.rating)-Number(b.rating)||Number(b.helpful_count)-Number(a.helpful_count)).slice(0,12).map(row=>{const product:any=productMap.get(String(row.product_id))||{},rowSignals=byReview.get(String(row.id))||[];return {id:row.id,reviewed_at:row.reviewed_at,platform:row.platform,product_code:product.product_code||row.product_code,product_name:product.product_name||row.product_code,rating:row.rating,review_text:row.review_text,topics:rowSignals.filter(signal=>signal.sentiment==='negative').map(signal=>signal.aspect_label),return_risk:rowSignals.some(signal=>signal.return_risk),response_status:row.seller_response_status}});
  return {hasData:total>0,summary:{reviews:total,averageRating,negativePct:total?negativeReviews.length/total*100:0,responseNeeded:responseNeeded.length,returnRisk:reviews.filter(row=>(byReview.get(String(row.id))||[]).some(signal=>signal.return_risk)).length},aspects:[...aspectMap.values()].sort((a,b)=>b.negative-a.negative||b.total-a.total),products:[...productAgg.values()].map(finalize).sort((a,b)=>b.negative_pct-a.negative_pct||b.reviews-a.reviews),channels:[...channelAgg.values()].map(finalize).sort((a,b)=>b.reviews-a.reviews),daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,average_rating:row.reviews?row.rating/row.reviews:0,negative_pct:row.reviews?row.negative/row.reviews*100:0})),evidence,actions:[...aspectMap.values()].filter(row=>row.negative>0).sort((a,b)=>b.negative-a.negative).slice(0,5).map(row=>({team:row.team||'상품기획',title:`${row.label} 부정 신호 확인`,detail:`부정 ${row.negative}건 · 관련 리뷰 근거와 제품별 집중도를 확인하세요.`}))};
}

function recommendedAction(code:string,sentiment:string){if(sentiment!=='negative')return '긍정 리뷰 소재 활용';return ({fit:'옵션별 실측·패턴 검토',material:'원단 스펙·상세 설명 검토',quality:'생산 LOT·검품 기준 확인',color:'상품 이미지·염색 편차 확인',design:'다음 기획 반영 여부 검토',price:'가격 인식과 경쟁가 비교',delivery:'배송·포장 SLA 확인',usability:'코디 콘텐츠·상품 설명 개선'} as any)[code]||'담당 팀 검토'}
function cleanCode(value:any){return String(value??'').trim().toUpperCase()||null}
function cleanText(value:any){return String(value??'').trim()||null}
function parseBoolean(value:any){return ['1','true','yes','y','예','네','구매인증','있음'].includes(String(value??'').trim().toLowerCase())}
function parseDate(value:any){if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString();const text=String(value??'').trim();if(!text)return null;const normalized=/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)?`${text}T00:00:00+09:00`:text;const date=new Date(normalized);return Number.isNaN(date.getTime())?null:date.toISOString()}
function normalizeResponse(value:any){const text=String(value??'').trim().toLowerCase();return ['responded','answered','완료','답변완료','답변'].includes(text)?'responded':['not_required','불필요'].includes(text)?'not_required':'pending'}
