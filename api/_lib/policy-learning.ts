const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const daysBetween=(start:string,end:string)=>Math.round((new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000);
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2};

export type LearningProfile={skuId:string;locationId:string;multiplier:number;confidence:number;evidenceCount:number;candidateId?:string};

export function deriveForecastBiasCandidates(outcomes:any[]=[],lines:any[]=[]){
  const lineMap=new Map(lines.map(row=>[String(row.id),row])),groups=new Map<string,any[]>();
  for(const outcome of outcomes){const line:any=lineMap.get(String(outcome.recommendation_line_id));if(!line||outcome.outcome_status!=='complete'||!outcome.learning_eligible||daysBetween(outcome.measurement_start_date,outcome.measurement_end_date)!==28)continue;const baseline=number(outcome.metrics?.baselineQty),actual=number(outcome.realized_sales_qty);if(baseline<=0||actual<0||!line.sku_id||!line.to_location_id)continue;const key=`${line.sku_id}:${line.to_location_id}`,items=groups.get(key)||[];items.push({outcomeId:outcome.id,executionId:outcome.execution_request_id,ratio:clamp(actual/baseline,.5,1.5),netValue:number(outcome.realized_net_value)});groups.set(key,items)}
  const candidates:any[]=[];for(const [key,evidence] of groups){const unique=[...new Map(evidence.map(item=>[String(item.executionId||item.outcomeId),item])).values()];if(unique.length<3)continue;const [skuId,locationId]=key.split(':'),raw=median(unique.map(item=>item.ratio)),shrink=unique.length/(unique.length+5),positiveShare=unique.filter(item=>item.netValue>0).length/unique.length;let multiplier=1+(raw-1)*shrink;if(positiveShare<.5)multiplier=Math.min(1,multiplier);multiplier=Number(clamp(multiplier,.8,1.2).toFixed(4));const confidence=Number(clamp(.45+unique.length*.06,0,.9).toFixed(4));candidates.push({candidateType:'forecast_bias',skuId,locationId,currentValue:{multiplier:1},proposedValue:{multiplier},evidenceCount:unique.length,evidence:unique.slice(-20),expectedImprovement:{direction:multiplier>=1?'increase':'decrease',positive_outcome_share:Number(positiveShare.toFixed(4))},confidence})}return candidates;
}

export function appliedLearningProfiles(candidates:any[]=[]):LearningProfile[]{return candidates.filter(row=>row.candidate_type==='forecast_bias'&&row.status==='applied').map(row=>({skuId:String(row.sku_id),locationId:String(row.location_id),multiplier:clamp(number(row.proposed_value?.multiplier)||1,.8,1.2),confidence:clamp(number(row.confidence),0,1),evidenceCount:Math.max(0,number(row.evidence_count)),candidateId:row.id}))}

export function learningMultiplier(profiles:LearningProfile[]=[],skuId:string,locationId:string){const profile=profiles.find(row=>row.skuId===skuId&&row.locationId===locationId);return profile||{skuId,locationId,multiplier:1,confidence:0,evidenceCount:0}}
