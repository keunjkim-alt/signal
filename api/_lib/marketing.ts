import {parseSpreadsheetDate} from './spreadsheet-date.js';

const normalize=(value:any)=>String(value??'').trim().toLowerCase().replace(/[\s._\-/()]+/g,'');

export const MARKETING_FIELDS={
  campaign_id:['campaign_id','campaign_code','id','캠페인id','캠페인코드'],
  campaign_name:['campaign_name','name','캠페인명','캠페인이름'],
  start_at:['start_at','start_date','started_at','시작일','시작일시'],
  end_at:['end_at','end_date','ended_at','종료일','종료일시'],
  channel_code:['channel_code','channel','platform','media','채널코드','채널','매체'],
  campaign_type:['campaign_type','type','objective','캠페인유형','목적'],
  budget:['budget','planned_budget','예산','계획예산'],
  spend:['spend','cost','ad_spend','집행액','광고비','사용금액'],
  impressions:['impressions','impression','노출','노출수'],
  clicks:['clicks','click','클릭','클릭수'],
  conversions:['conversions','conversion','orders','전환','전환수'],
  attributed_sales:['attributed_sales','revenue','sales','conversion_value','기여매출','전환매출'],
  control_group_size:['control_group_size','control_size','대조군수','대조군크기'],
  control_group_conversions:['control_group_conversions','control_conversions','대조군전환','대조군전환수'],
  owner:['owner','manager','담당자'],
  status:['status','campaign_status','상태','진행상태'],
  source_updated_at:['source_updated_at','updated_at','observed_at','date','기준일시','집계일','업데이트일시']
};

export const MARKETING_REQUIRED_FIELDS=['campaign_id','campaign_name','start_at','end_at','channel_code','budget','spend','impressions','clicks','conversions','attributed_sales','source_updated_at'];

export function inferMarketingMapping(headers:string[],requested:any={}){
  const byNormalized=new Map(headers.map(header=>[normalize(header),header])),mapping:any={};
  for(const [canonical,aliases] of Object.entries(MARKETING_FIELDS)){
    const explicit=requested[canonical];if(explicit&&headers.includes(explicit)){mapping[canonical]=explicit;continue}
    const match=(aliases as string[]).map(normalize).find(alias=>byNormalized.has(alias));if(match)mapping[canonical]=byNormalized.get(match);
  }
  return mapping;
}

export function validateAndNormalizeMarketing(rows:Record<string,any>[],mapping:any){
  const missingFields=MARKETING_REQUIRED_FIELDS.filter(field=>!mapping[field]);
  if(missingFields.length)return {validRows:[],errors:[],missingFields,period:{start:null,end:null}};
  const validRows:any[]=[],errors:any[]=[];
  rows.forEach((row,index)=>{
    const get=(field:string)=>row[mapping[field]],campaignId=text(get('campaign_id')),campaignName=text(get('campaign_name')),startAt=date(get('start_at')),endAt=date(get('end_at')),observedAt=date(get('source_updated_at')),channelCode=code(get('channel_code'));
    const numbers:any={budget:number(get('budget')),spend:number(get('spend')),impressions:integer(get('impressions')),clicks:integer(get('clicks')),conversions:integer(get('conversions')),attributed_sales:number(get('attributed_sales')),control_group_size:optionalInteger(get('control_group_size')),control_group_conversions:optionalInteger(get('control_group_conversions'))};
    const invalid:string[]=[];
    if(!campaignId)invalid.push('campaign_id');if(!campaignName)invalid.push('campaign_name');if(!startAt)invalid.push('start_at');if(!endAt)invalid.push('end_at');if(!observedAt)invalid.push('source_updated_at');if(!channelCode)invalid.push('channel_code');
    for(const field of ['budget','spend','impressions','clicks','conversions','attributed_sales'])if(!Number.isFinite(numbers[field])||numbers[field]<0)invalid.push(field);
    if(startAt&&endAt&&endAt<startAt)invalid.push('end_at');if(numbers.clicks>numbers.impressions)invalid.push('clicks');if(numbers.conversions>numbers.clicks)invalid.push('conversions');if(numbers.control_group_conversions!=null&&numbers.control_group_size!=null&&numbers.control_group_conversions>numbers.control_group_size)invalid.push('control_group_conversions');
    if(invalid.length){errors.push({row_number:index+2,error_code:'INVALID_ROW',field_name:[...new Set(invalid)].join(','),message:`필수값 또는 범위 오류: ${[...new Set(invalid)].join(', ')}`,raw_row:row});return}
    validRows.push({row_number:index+2,source_campaign_id:campaignId,campaign_name:campaignName,start_at:startAt,end_at:endAt,channel_code:channelCode,campaign_type:text(get('campaign_type')),budget:numbers.budget,spend:numbers.spend,impressions:numbers.impressions,clicks:numbers.clicks,conversions:numbers.conversions,attributed_sales:numbers.attributed_sales,control_group_size:numbers.control_group_size,control_group_conversions:numbers.control_group_conversions,owner:text(get('owner')),status:campaignStatus(get('status')),observed_at:observedAt,raw_row:row});
  });
  const timestamps=validRows.map(row=>row.observed_at).sort();return {validRows,errors,missingFields:[],period:{start:timestamps[0]||null,end:timestamps.at(-1)||null}};
}

export function marketingControlTotals(rows:any[]){return {rows:rows.length,campaigns:new Set(rows.map(row=>row.source_campaign_id)).size,spend:sum(rows,'spend'),conversions:sum(rows,'conversions'),attributedSales:sum(rows,'attributed_sales')}}

export function summarizeMarketingInsights(campaigns:any[],snapshots:any[]){
  const campaignMap=new Map(campaigns.map(row=>[String(row.id),row])),latest=new Map<string,any>();
  for(const row of snapshots){const key=String(row.campaign_id),current=latest.get(key);if(!current||String(row.observed_at)>String(current.observed_at))latest.set(key,row)}
  const campaignRows=campaigns.filter(row=>latest.has(String(row.id))).map(row=>{const snapshot=latest.get(String(row.id))||{},spend=Number(snapshot.spend||0),sales=Number(snapshot.attributed_sales||0),impressions=Number(snapshot.impressions||0),clicks=Number(snapshot.clicks||0),conversions=Number(snapshot.conversions||0),budget=Number(row.budget||0),controlSize=Number(snapshot.control_group_size||0),controlConversions=Number(snapshot.control_group_conversions||0),treatmentRate=impressions?conversions/impressions:0,controlRate=controlSize?controlConversions/controlSize:null,incrementalConversions=controlRate==null?null:Math.max(0,(treatmentRate-controlRate)*impressions),revenuePerConversion=conversions?sales/conversions:0,incrementalSales=incrementalConversions==null?null:incrementalConversions*revenuePerConversion;return {...row,...snapshot,label:row.campaign_name,value:sales,budget,spend,impressions,clicks,conversions,attributed_sales:sales,budget_utilization:budget?spend/budget*100:0,roas:spend?sales/spend:0,ctr:impressions?clicks/impressions*100:0,cvr:clicks?conversions/clicks*100:0,control_rate:controlRate==null?null:controlRate*100,incremental_conversions:incrementalConversions,incremental_sales:incrementalSales,iroas:spend&&incrementalSales!=null?incrementalSales/spend:null}});
  const channelMap=new Map<string,any>();for(const row of campaignRows){const key=row.channel_code||'OTHER',item=channelMap.get(key)||{channel_code:key,campaigns:0,budget:0,spend:0,attributed_sales:0,conversions:0,impressions:0,clicks:0};item.campaigns++;for(const field of ['budget','spend','attributed_sales','conversions','impressions','clicks'])item[field]+=Number(row[field]||0);channelMap.set(key,item)}
  const channels=[...channelMap.values()].map(row=>({...row,label:row.channel_code,value:row.attributed_sales,roas:row.spend?row.attributed_sales/row.spend:0,ctr:row.impressions?row.clicks/row.impressions*100:0,cvr:row.clicks?row.conversions/row.clicks*100:0})).sort((a,b)=>b.attributed_sales-a.attributed_sales);
  const dailyMap=new Map<string,any>();for(const row of snapshots){const campaign=campaignMap.get(String(row.campaign_id))||{},day=String(row.observed_at||'').slice(0,10),key=`${day}:${row.campaign_id}`,current=dailyMap.get(key);if(!current||String(row.observed_at)>String(current.observed_at))dailyMap.set(key,{...row,date:day,channel_code:campaign.channel_code})}
  const dailyAggregate=new Map<string,any>();for(const row of dailyMap.values()){const item=dailyAggregate.get(row.date)||{date:row.date,spend:0,attributed_sales:0,impressions:0,clicks:0,conversions:0};for(const field of ['spend','attributed_sales','impressions','clicks','conversions'])item[field]+=Number(row[field]||0);dailyAggregate.set(row.date,item)}
  const trend=[...dailyAggregate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,roas:row.spend?row.attributed_sales/row.spend:0}));
  const summary={campaigns:campaignRows.length,activeCampaigns:campaignRows.filter(row=>row.status==='in_progress').length,budget:sum(campaignRows,'budget'),spend:sum(campaignRows,'spend'),attributedSales:sum(campaignRows,'attributed_sales'),conversions:sum(campaignRows,'conversions'),impressions:sum(campaignRows,'impressions'),clicks:sum(campaignRows,'clicks')};
  const actions=campaignRows.flatMap(row=>{const result:any[]=[];if(row.budget_utilization>100)result.push({priority:'P0',campaignId:row.source_campaign_id,title:`${row.campaign_name} 예산 초과 확인`,detail:`예산 대비 ${row.budget_utilization.toFixed(0)}% 집행되었습니다.`});else if(row.status==='in_progress'&&row.roas<1.5)result.push({priority:'P1',campaignId:row.source_campaign_id,title:`${row.campaign_name} 효율 조정`,detail:`ROAS ${row.roas.toFixed(2)}배로 소재·타깃·예산 재배분 검토가 필요합니다.`});return result}).slice(0,8);
  return {hasData:campaignRows.length>0,generatedAt:new Date().toISOString(),summary:{...summary,roas:summary.spend?summary.attributedSales/summary.spend:0,ctr:summary.impressions?summary.clicks/summary.impressions*100:0,cvr:summary.clicks?summary.conversions/summary.clicks*100:0,budgetUtilization:summary.budget?summary.spend/summary.budget*100:0,incrementalSales:campaignRows.reduce((total,row)=>total+Number(row.incremental_sales||0),0)},campaigns:campaignRows.sort((a,b)=>b.attributed_sales-a.attributed_sales),channels,trend,actions};
}

function campaignStatus(value:any){const raw=String(value??'').trim().toLowerCase();return ({active:'in_progress',running:'in_progress','진행중':'in_progress','진행 중':'in_progress',complete:'completed','완료':'completed',pause:'paused','중지':'paused','취소':'cancelled','예정':'planned'} as Record<string,string>)[raw]||(['planned','in_progress','completed','paused','cancelled'].includes(raw)?raw:'planned')}
function text(value:any){return String(value??'').trim()||null}
function code(value:any){return String(value??'').trim().toUpperCase()||null}
function number(value:any){const normalized=String(value??'').replace(/[₩$,%\s,]/g,''),parsed=Number(normalized);return Number.isFinite(parsed)?parsed:NaN}
function integer(value:any){const parsed=number(value);return Number.isFinite(parsed)?Math.floor(parsed):NaN}
function optionalInteger(value:any){if(value==null||String(value).trim()==='')return null;return integer(value)}
function date(value:any){return parseSpreadsheetDate(value,{assumeKst:true})}
function sum(items:any[],key:string){return items.reduce((total,item)=>total+Number(item[key]||0),0)}
