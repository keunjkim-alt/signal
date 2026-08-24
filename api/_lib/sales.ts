const normalize=(value:any)=>String(value??'').trim().toLowerCase().replace(/[\s._\-/()]+/g,'');

export const SALES_FIELDS={
  sold_at:['sold_at','ordered_at','sale_date','order_date','판매일시','주문일시','결제일시','판매일','주문일','거래일'],
  channel_code:['channel_code','channel','platform','sales_channel','채널코드','판매채널','채널','플랫폼'],
  sku_code:['sku_code','sku','item_code','품번','상품코드','단품코드','품목코드','옵션코드','바코드','barcode'],
  quantity:['quantity','qty','sales_qty','수량','판매수량','주문수량','결제수량'],
  net_sales:['net_sales','paid_amount','sales_amount','payment_amount','순매출','결제금액','실결제금액','판매금액','매출액'],
  unit_cost:['unit_cost','cost_price','purchase_price','원가','상품원가','매입단가','개당원가'],
  channel_fee:['channel_fee','platform_fee','commission','채널수수료','플랫폼수수료','판매수수료','수수료'],
  marketing_cost:['marketing_cost','ad_cost','advertising_cost','마케팅비','광고비','광고배부액'],
  shipping_cost:['shipping_cost','delivery_cost','fulfillment_cost','배송비','물류비','출고비'],
  return_cost:['return_cost','refund_cost','return_handling_cost','반품비','반품처리비','환불비용'],
  location_code:['location_code','store_code','shop_code','매장코드','점코드','출고지코드','창고코드'],
  location_name:['location_name','store_name','shop_name','매장명','점명','출고지명','창고명'],
  product_name:['product_name','item_name','상품명','제품명','품목명'],
  category:['category','category_l1','카테고리','대분류','상품군'],
  order_id:['order_id','order_no','order_number','transaction_id','주문번호','거래번호','결제번호'],
  line_id:['line_id','order_line_id','item_id','line_no','주문상세번호','주문라인번호','상품주문번호'],
  country_code:['country_code','country','국가코드','국가'],
  currency_code:['currency_code','currency','통화코드','통화'],
  source_updated_at:['source_updated_at','updated_at','modified_at','수정일시','업데이트일시','최종수정일']
};

export const SALES_REQUIRED_FIELDS=['sold_at','channel_code','sku_code','quantity','net_sales'];

export function inferSalesMapping(headers:string[],requested:any={}){
  const byNormalized=new Map(headers.map(header=>[normalize(header),header])),mapping:any={};
  for(const [canonical,aliases] of Object.entries(SALES_FIELDS)){
    const explicit=requested[canonical];
    if(explicit&&headers.includes(explicit)){mapping[canonical]=explicit;continue}
    const match=(aliases as string[]).map(normalize).find(alias=>byNormalized.has(alias));
    if(match)mapping[canonical]=byNormalized.get(match);
  }
  return mapping;
}

export function validateAndNormalizeSales(rows:Record<string,any>[],mapping:any){
  const missingFields=SALES_REQUIRED_FIELDS.filter(field=>!mapping[field]);
  if(missingFields.length)return {validRows:[],errors:[],missingFields,period:{start:null,end:null}};
  const validRows:any[]=[],errors:any[]=[],occurrences=new Map<string,number>();
  rows.forEach((row,index)=>{
    const get=(field:string)=>row[mapping[field]],soldAt=parseDate(get('sold_at')),channelCode=cleanCode(get('channel_code')),skuCode=cleanCode(get('sku_code')),quantity=parseNumber(get('quantity')),netSales=parseNumber(get('net_sales'));
    const invalid:string[]=[];
    if(!soldAt)invalid.push('sold_at');
    if(!channelCode)invalid.push('channel_code');
    if(!skuCode)invalid.push('sku_code');
    if(quantity===null||quantity<=0)invalid.push('quantity');
    if(netSales===null||netSales<0)invalid.push('net_sales');
    if(invalid.length){errors.push({row_number:index+2,error_code:'INVALID_ROW',field_name:invalid.join(','),message:`필수값 오류: ${invalid.join(', ')}`,raw_row:row});return}
    const locationCode=cleanCode(get('location_code'))||null,explicitOrder=cleanText(get('order_id')),sourceOrderId=explicitOrder||`AUTO:${soldAt.slice(0,10)}:${channelCode}:${locationCode||'ONLINE'}:${index+2}`;
    const lineSeed=`${sourceOrderId}:${skuCode}`,occurrence=(occurrences.get(lineSeed)||0)+1;occurrences.set(lineSeed,occurrence);
    const sourceLineId=cleanText(get('line_id'))||`${skuCode}:${occurrence}`;
    validRows.push({
      row_number:index+2,source_order_id:sourceOrderId,source_line_id:sourceLineId,sold_at:soldAt,channel_code:channelCode,sku_code:skuCode,quantity,net_sales:netSales,
      unit_cost:nonNegativeNumber(get('unit_cost')),channel_fee:nonNegativeNumber(get('channel_fee')),marketing_cost:nonNegativeNumber(get('marketing_cost')),shipping_cost:nonNegativeNumber(get('shipping_cost')),return_cost:nonNegativeNumber(get('return_cost')),
      location_code:locationCode,location_name:cleanText(get('location_name'))||locationCode,product_name:cleanText(get('product_name'))||skuCode,category:cleanText(get('category'))||null,
      country_code:normalizeCountry(get('country_code')),currency_code:cleanCode(get('currency_code'))||'KRW',source_updated_at:parseDate(get('source_updated_at'))||null,raw_row:row
    });
  });
  const timestamps=validRows.map(row=>row.sold_at).sort();
  return {validRows,errors,missingFields:[],period:{start:timestamps[0]||null,end:timestamps.at(-1)||null}};
}

function cleanCode(value:any){return String(value??'').trim().toUpperCase()||null}
function cleanText(value:any){return String(value??'').trim()||null}
function parseNumber(value:any){if(value===null||value===undefined||value==='')return null;const number=Number(String(value).replace(/[,₩원\s]/g,''));return Number.isFinite(number)?number:null}
function nonNegativeNumber(value:any){const number=parseNumber(value);return number===null?0:Math.max(0,number)}
function parseDate(value:any){if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString();const text=String(value??'').trim();if(!text)return null;let normalized=text.replace(/[./]/g,'-');if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized))normalized=`${normalized}T00:00:00+09:00`;else if(/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(normalized))normalized=`${normalized.replace(' ','T')}+09:00`;const date=new Date(normalized);return Number.isNaN(date.getTime())?null:date.toISOString()}
function normalizeCountry(value:any){const code=cleanCode(value);if(!code)return 'KR';return ({한국:'KR',대한민국:'KR',KOREA:'KR',중국:'CN',CHINA:'CN',일본:'JP',JAPAN:'JP'} as any)[code]||code.slice(0,2)}
