const priorityScore:Record<string,number>={P0:0,P1:1,P2:2};
const productionNext:Record<string,{status:string;label:string}>={
  approved:{status:'planning',label:'생산 계획'},
  planning:{status:'materials',label:'원부자재'},
  materials:{status:'cutting',label:'재단'},
  cutting:{status:'sewing',label:'봉제'},
  sewing:{status:'inspection',label:'검품'},
  inspection:{status:'completed',label:'생산 완료'},
  held:{status:'planning',label:'생산 계획 재개'}
};

const number=(value:any)=>Number.isFinite(Number(value))?Number(value):0;
const integer=(value:any)=>Math.max(0,Math.round(number(value)));
const percent=(value:any)=>`${Math.round(number(value)*100)}%`;
const money=(value:any)=>`₩${Math.max(0,Math.round(number(value)/1000000)).toLocaleString()}M`;
const clean=(value:any)=>String(value||'').replace(/[^a-zA-Z0-9가-힣:_-]/g,'-').slice(0,160);

export function buildDecisionActions(input:any={}){
  const transfers=input.transfers||[],reorders=input.reorders||[],discounts=input.discounts||[],productionOrders=input.productionOrders||[],actions:any[]=[];

  for(const row of transfers.filter((item:any)=>item.status==='recommended').slice(0,3)){
    const qty=integer(row.recommended_qty),from=String(row.from_location?.location_name||'출발지'),to=String(row.to_location?.location_name||'도착지'),code=String(row.sku?.product_code||row.sku?.sku_code||'SKU'),fromQty=integer(row.reason?.from_available),toQty=integer(row.reason?.to_available),priority=qty>=100?'P0':'P1';
    actions.push({
      key:`today:transfer:${clean(row.proposal_key||`${row.sku_id}:${row.from_location_id}:${row.to_location_id}`)}`,kind:'transfer',priority,type:'재고 이동',target_page:'inventory',team_code:'재고·물류팀',title:`${code} ${from} → ${to} ${qty.toLocaleString()}pcs`,scope:'재고·물류',basis:`출발 ${fromQty.toLocaleString()}pcs · 도착 ${toQty.toLocaleString()}pcs · 안전재고 제외 후 이동 가능`,impact:`재고 불균형 ${qty.toLocaleString()}pcs 해소`,impact_amount:0,risk:`판매 집중 위치의 품절 위험 지속`,confidence:'92%',source:'WMS · 최신 위치별 재고',owner:'재고·물류팀',due:'오늘 16:00',recommendation:`오늘 ${from}에서 ${to}로 ${qty.toLocaleString()}pcs 이동 승인`,approve_label:'이동 승인',adjust_label:'수량 조정',
      evidence:[[`${fromQty.toLocaleString()}pcs`,`${from} 가용재고`],[`${toQty.toLocaleString()}pcs`,`${to} 가용재고`],[`${qty.toLocaleString()}pcs`,'안전재고 반영 권장 이동량']],effect_title:`재고 불균형 ${qty.toLocaleString()}pcs 해소`,effect_lines:[`${to}의 판매 대응 재고를 보강`,`추가 발주 전에 회사 내 재고를 우선 활용`],risk_title:'부족 위치의 품절 위험이 계속됩니다',risk_lines:['판매 가능한 재고가 다른 위치에 묶임','고객 수요가 있는 위치에서 판매 기회 손실 가능'],constraints:[`${from} 안전재고 유지`,'물류 배차·출고 마감시간 확인'],
      execution:{action:'approve_transfer',transferOrderId:row.id||null,proposalKey:row.proposal_key,skuId:row.sku_id,fromLocationId:row.from_location_id,toLocationId:row.to_location_id,recommendedQty:qty,approvedQty:qty,reason:{...row.reason,source:'today_action'}}
    });
  }

  for(const row of reorders.filter((item:any)=>item.status!=='approved').slice(0,4)){
    const qty=integer(row.recommended_reorder_qty),forecast=integer(row.forecast_quantity),available=integer(row.available_qty),forecastSales=number(row.forecast_net_sales),confidence=number(row.confidence),code=String(row.product_code||'상품'),priority=qty>=300&&confidence>=.5?'P0':'P1';
    actions.push({
      key:`today:reorder:${clean(code)}`,kind:'reorder',priority,type:'재주문',target_page:'inventory',team_code:'재고·물류팀',title:`${code} ${qty.toLocaleString()}pcs 재주문`,scope:'MD · 생산·SCM',basis:`28일 수요 ${forecast.toLocaleString()}pcs · 현재 재고 ${available.toLocaleString()}pcs · 생산 리드타임 14일`,impact:`수요예측 매출 ${money(forecastSales)} 보호`,impact_amount:forecastSales,risk:'생산 리드타임 이후 판매 공백 가능',confidence:percent(confidence),source:'Forecast · WMS · ERP',owner:'MD · 생산·SCM',due:'오늘 18:00',recommendation:`${code} ${qty.toLocaleString()}pcs를 오늘 생산오더로 전환`,approve_label:'재주문 승인',adjust_label:'수량 조정',
      evidence:[[`${forecast.toLocaleString()}pcs`,'28일 예측 수요'],[`${available.toLocaleString()}pcs`,'현재 회사 전체 가용재고'],[`${qty.toLocaleString()}pcs`,'리드타임·안전재고 반영 부족량']],effect_title:`예측 매출 ${money(forecastSales)} 대응`,effect_lines:['생산 리드타임을 포함한 부족 수량 확보','승인 즉시 생산 실행 큐에 오더 생성'],risk_title:'다음 입고 전 판매 공백 가능',risk_lines:['주요 SKU부터 순차 품절 가능','재입고 지연 시 예상 매출 일부 손실'],constraints:['생산 MOQ와 발주 단위 확인','공장 가용 슬롯과 원부자재 납기 확인'],
      execution:{action:'approve_reorder',productCode:code,quantity:qty,forecast:{product_name:row.product_name||code,forecast_quantity:forecast,forecast_net_sales:forecastSales,available_qty:available,confidence,horizon_days:number(row.horizon_days)||28,safety_stock_qty:number(row.safety_stock_qty)}}
    });
  }

  for(const row of discounts.filter((item:any)=>item.decision_status==='proposed').slice(0,3)){
    const current=number(row.current_discount_rate),recommended=number(row.recommended_discount_rate),uplift=number(row.contribution_uplift),cover=number(row.inventory_cover_days),reduce=recommended<current,code=String(row.product_code||'상품'),channel=String(row.channel_code||'채널'),priority=uplift>=10000000?'P1':'P2',decision=reduce?'할인 축소':recommended>current?'한정 할인':'가격 유지';
    actions.push({
      key:`today:discount:${clean(row.recommendation_id)}`,kind:'discount',priority,type:decision,target_page:'profitability',team_code:'영업·마케팅팀',title:`${code} · ${channel} ${decision} ${recommended}%`,scope:'영업 · 이커머스 · 마케팅',basis:`현재 ${current}% · 최적 ${recommended}% · 재고커버 ${cover.toFixed(1)}일`,impact:`기여이익 ${money(uplift)} 개선`,impact_amount:Math.max(0,uplift),risk:'할인 시점·범위가 늦어지면 정상가 또는 재고 소진 기회 저하',confidence:percent(row.confidence),source:'판매·원가·정산 · 할인 최적화',owner:'영업 · 이커머스',due:'오늘 17:00',recommendation:`${channel}에서 ${code} 할인율을 ${recommended}%로 승인`,approve_label:'가격안 승인',adjust_label:'할인율 조정',
      evidence:[[`${current}%`,'현재 실질 할인율'],[`${recommended}%`,'기여이익 기준 추천 할인율'],[`${cover.toFixed(1)}일`,'현재 재고커버']],effect_title:`예상 기여이익 ${money(uplift)} 개선`,effect_lines:[row.non_discount_action||'채널·상품 단위로 할인 범위를 제한','승인된 값과 근거를 가격 실행 이력에 저장'],risk_title:'가격 결정 지연으로 판매 기회가 낮아집니다',risk_lines:['정상가 판매 가능 상품의 불필요한 할인 위험','과잉재고 상품의 소진 시점 지연 가능'],constraints:['브랜드 최대 할인율과 최소 이익률 확인','채널별 가격정책과 MD 승인 확인'],
      execution:{action:'approve_discount',recommendationId:row.recommendation_id,status:'approved'}
    });
  }

  for(const row of productionOrders.filter((item:any)=>productionNext[item.production_status]).slice(0,3)){
    const next=productionNext[row.production_status],code=String(row.product_code||'상품'),qty=integer(row.quantity),sales=number(row.forecast_net_sales);
    actions.push({
      key:`today:production:${clean(row.id)}:${next.status}`,kind:'production',priority:'P1',type:'생산 진행',target_page:'production',team_code:'생산·SCM팀',title:`${code} ${next.label} 착수`,scope:'생산 · SCM',basis:`승인 수량 ${qty.toLocaleString()}pcs · 현재 진척 ${integer(row.progress)}% · 입고 목표 ${row.due_date||'미정'}`,impact:`예측 매출 ${money(sales)} 대응 일정 유지`,impact_amount:sales,risk:'공정 전환 지연 시 입고 목표일 변동 가능',confidence:percent(row.confidence),source:'승인 재주문 · 생산 실행 큐',owner:'생산·SCM팀',due:'오늘 16:00',recommendation:`${row.production_order_no||code}를 ${next.label} 단계로 전환`,approve_label:`${next.label} 승인`,adjust_label:'일정 조정',
      evidence:[[`${qty.toLocaleString()}pcs`,'승인 생산수량'],[`${integer(row.progress)}%`,'현재 공정 진척'],[row.due_date||'미정','목표 입고일']],effect_title:'승인 수요의 생산 일정을 유지',effect_lines:[`${next.label} 단계로 실행 이력 전환`,'담당 팀의 다음 공정 버튼이 자동 갱신'],risk_title:'생산·입고 일정 지연 가능',risk_lines:['후속 공정 가용시간 감소','예측 수요 대응 재고의 입고 지연'],constraints:['공장·원부자재 가용 여부 확인','공정 담당자의 실행 권한 확인'],
      execution:{action:'update_production_order',recommendationId:row.id,status:next.status}
    });
  }

  return actions.sort((a,b)=>(priorityScore[a.priority]??9)-(priorityScore[b.priority]??9)||number(b.impact_amount)-number(a.impact_amount)||a.title.localeCompare(b.title,'ko')).slice(0,12);
}

export function summarizeDecisionActions(actions:any[]=[]){
  const pending=actions.filter(row=>!['approved','executed'].includes(row.decision_status||'proposed'));
  return {total:actions.length,pending:pending.length,approved:actions.filter(row=>['approved','executed'].includes(row.decision_status)).length,p0:pending.filter(row=>row.priority==='P0').length,dueToday:pending.filter(row=>String(row.due||'').startsWith('오늘')).length,impactAmount:pending.reduce((sum,row)=>sum+Math.max(0,number(row.impact_amount)),0)};
}
