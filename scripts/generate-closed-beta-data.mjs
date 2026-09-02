import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),output=resolve(here,'../assets/templates/closed-beta');
mkdirSync(output,{recursive:true});

const products=[
  ['ARC-07-BLK-F','Utility Jacket','OUTER',248000,82000],['FLOW-22-BLK-F','Drape Pants','BOTTOM',158000,51000],['EASE-19-IVY-F','Layer Top','TOP',89000,27000],['CORE-08-GRY-F','Core Knit','TOP',119000,39000],
  ['AIR-24-NVY-F','Volume Dress','DRESS',198000,65000],['FRAME-31-DNM-F','Denim Dress','DRESS',228000,78000],['SHEER-15-WHT-F','Sheer Layer Top','TOP',99000,31000],['FORM-12-BLK-F','Relaxed Blazer','OUTER',268000,91000]
];
const locations=[['ONLINE','온라인몰'],['STORE-SEONGSU','성수 플래그십'],['STORE-GANGNAM','강남점'],['STORE-HANNAM','한남점'],['STORE-BUSAN','부산 센텀'],['STORE-SHANGHAI','상하이 IFC'],['DC-ONLINE','온라인 DC']];
const channels=[['자사몰','ONLINE','온라인몰',.04,.035],['무신사','ONLINE','온라인몰',.12,.045],['29CM','ONLINE','온라인몰',.14,.04],['네이버','ONLINE','온라인몰',.08,.025],['W컨셉','ONLINE','온라인몰',.15,.035],['매장 POS','STORE-SEONGSU','성수 플래그십',.02,.01]];
const regions=[['서울','성동구'],['서울','강남구'],['경기','성남시'],['부산','해운대구'],['인천','연수구'],['대구','수성구']];
const salesHeaders=['sold_at','channel_code','sku_code','quantity','net_sales','unit_cost','channel_fee','marketing_cost','shipping_cost','return_cost','returned_quantity','location_code','location_name','product_name','category','order_id','line_id','country_code','currency_code','customer_token','shipping_region_1','shipping_region_2','order_status'];
const sales=[salesHeaders];
for(let day=0;day<30;day++)for(let p=0;p<products.length;p++)for(let c=0;c<channels.length;c++){
  const [sku,name,category,listPrice,unitCost]=products[p],[channel,defaultLocationCode,defaultLocationName,feeRate,marketingRate]=channels[c],posLocation=locations[(day+p)%locations.length],[locationCode,locationName]=channel==='매장 POS'?posLocation:[defaultLocationCode,defaultLocationName],date=new Date(Date.UTC(2026,7,23-day,10+(p+c+day)%12,(p*11+c*7)%60));
  const quantity=Math.max(1,Math.round((4+p*1.4+c*.8)*(1+Math.sin((day+p+c)/3)*.28))),discount=[.03,.12,.1,.06,.14,.02][c],cancelled=(day*13+p*7+c)%79===0,returned=cancelled?0:((day+p+c)%17===0?Math.max(1,Math.round(quantity*.2)):0),salePrice=Math.round(listPrice*(1-discount)),netSales=cancelled?0:quantity*salePrice,region=regions[(day+p+c)%regions.length],customer=`CUST-${String((day*37+p*11+c*5)%420+1).padStart(4,'0')}`;
  sales.push([date.toISOString(),channel,sku,quantity,netSales,unitCost,Math.round(netSales*feeRate),Math.round(netSales*marketingRate),channel==='매장 POS'?0:3500,returned?Math.round(returned*salePrice*.04):0,returned,locationCode,locationName,name,category,`BETA-${String(day).padStart(2,'0')}-${p}-${c}`,'1',channel==='매장 POS'&&day%11===0?'CN':'KR','KRW',customer,region[0],region[1],cancelled?'cancelled':'paid']);
}

const inventoryHeaders=['sku_code','location_code','location_name','snapshot_at','on_hand_qty','reserved_qty','available_qty','in_transit_qty','damaged_qty','safety_stock_qty'],inventory=[inventoryHeaders];
for(let p=0;p<products.length;p++)for(let l=0;l<locations.length;l++){
  const available=45+p*31+l*19+(p===0&&l===2?-38:0)+(p===1&&l===1?210:0),reserved=(p+l)%13,onHand=available+reserved,inTransit=(p+l)%4===0?40:0;
  inventory.push([products[p][0],locations[l][0],locations[l][1],'2026-08-24T09:00:00+09:00',onHand,reserved,available,inTransit,(p+l)%9===0?2:0,35+p*3]);
}

const csv=rows=>rows.map(row=>row.map(value=>{const text=String(value??'');return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text}).join(',')).join('\n')+'\n';
writeFileSync(resolve(output,'VIIMsignal_Closed_Beta_Sales_30D.csv'),csv(sales));
writeFileSync(resolve(output,'VIIMsignal_Closed_Beta_Inventory.csv'),csv(inventory));
const reviewProducts=[
  ['ARC-07-BLK-F','Utility Jacket','BLACK','FREE'],['FLOW-22-BLK-F','Drape Pants','BLACK','FREE'],['EASE-19-CRM-F','Layer Top','CREAM','FREE'],['CORE-55-WHT-F','Logo Tee','WHITE','FREE'],['AIR-24-NVY-F','Airy Volume Dress','NAVY','FREE'],['COVE-14-BLK-F','Maxi Dress','BLACK','FREE'],['EDGE-28-GRY-F','Zip Jacket','GREY','FREE'],['FORM-42-DEN-F','Denim Skirt','DENIM','FREE'],['LUME-09-BEG-F','Knit Cardigan','BEIGE','FREE'],['MOSS-18-BLK-F','Volume Bermuda','BLACK','FREE'],['NOVA-11-NVY-F','Volume Dress','NAVY','FREE'],['WAVE-31-WHT-F','Sheer Shirt','WHITE','FREE']
],reviewPlatforms=['자사몰','무신사','29CM','네이버','W컨셉'],positiveTexts=['디자인이 예쁘고 코디하기 좋아서 자주 입게 됩니다.','소재가 부드럽고 핏이 좋아요. 화면과 색상도 같습니다.','배송이 빠르고 포장이 깔끔해 만족합니다.','가격 대비 만족스럽고 활용하기 좋아요.'],neutralTexts=['전체적으로 무난합니다. 조금 더 입어보고 판단할게요.','생각했던 것과 비슷하고 데일리로 입기 괜찮아요.'],negativeByProduct={
  'ARC-07-BLK-F':['사이즈가 작게 나와 타이트하고 소매가 짧아요. 교환을 고민 중입니다.','핏이 생각보다 작아요. 상세 실측을 다시 확인해주세요.'],
  'FLOW-22-BLK-F':['원단이 얇고 비쳐요. 가격 대비 소재가 아쉽습니다.','소재가 생각보다 얇아서 활용하기 어려워요.'],
  'EASE-19-CRM-F':['봉제 마감이 아쉽고 실밥이 보여요.','한 번 입었는데 올이 풀려 품질 확인이 필요합니다.'],
  'WAVE-31-WHT-F':['화면보다 색상이 밝고 많이 비쳐요.','소재가 얇고 색상이 화면과 달라 아쉽습니다.']
};
const reviewHeaders=['review_id','reviewed_at','platform','channel_code','product_code','sku_code','product_name','rating','review_text','verified_purchase','helpful_count','image_review','customer_token','order_id','country_code','color','size','seller_response_status'],reviews=[reviewHeaders];
for(let day=0;day<40;day++)for(let p=0;p<reviewProducts.length;p++){
  const [code,name,color,size]=reviewProducts[p],platform=reviewPlatforms[(day+p)%reviewPlatforms.length],negative=Boolean(negativeByProduct[code])&&((day+p)%4===0||day<8),neutral=!negative&&(day+p)%7===0,text=negative?negativeByProduct[code][(day+p)%2]:neutral?neutralTexts[(day+p)%neutralTexts.length]:positiveTexts[(day*3+p)%positiveTexts.length],rating=negative?1+(day+p)%2:neutral?3:4+(day+p)%2,date=new Date(Date.UTC(2026,7,31-day,12+(p%8),p*4));
  reviews.push([`RV-${String(day).padStart(2,'0')}-${String(p).padStart(2,'0')}`,date.toISOString(),platform,platform,code,code,name,rating,text,true,(day*5+p*3)%31,(day+p)%3===0,`CUST-${String((day*17+p*13)%420+1).padStart(4,'0')}`,`BETA-R-${day}-${p}`,'KR',color,size,negative&&day%3?'pending':'responded']);
}
writeFileSync(resolve(output,'VIIMsignal_Closed_Beta_Reviews_90D.csv'),csv(reviews));
writeFileSync(resolve(output,'README.txt'),['VIIMsignal 클로즈드 베타 연결형 데이터팩','1) Sales_30D 파일을 판매 주문으로 미리보기·적재합니다.','2) Inventory 파일을 재고 스냅샷으로 미리보기·적재합니다.','3) Reviews_90D 파일을 리뷰·VOC로 미리보기·적재합니다.','4) 판매 현황, 수익성·할인, 고객 인사이트, 반품·취소, 재고 운영, 오늘의 액션을 확인합니다.','직접 식별정보는 없으며 customer_token은 가상의 익명 ID입니다.','','운영 보조 파일','- VIIMsignal_Beta_Field_Mapping.csv: 회사 원천 컬럼·담당자·갱신 주기 확인','- VIIMsignal_Beta_User_Roster.csv: 팀 사용자 일괄 등록 예시','- VIIMsignal_Beta_Daily_Checklist.csv: 매일 데이터·AX·안건 상태 점검','- VIIMsignal_Beta_Feedback_Log.csv: 사용자 피드백과 효과 기록','- VIIMsignal_Beta_Quick_Start.txt: 첫 로그인부터 승인·감사 이력까지 빠른 시작','','운영 시나리오 데이터팩 (scenario-packs 폴더)','1) VIIMsignal_Pack1_Baseline_Sales_90D_v2.csv: 2026-05-20–08-17 판매 기준선 · 6,480행','2) VIIMsignal_Pack1_Baseline_Inventory_v2.csv: 2026-08-17 이벤트 전 재고 기준 · 84행','3) VIIMsignal_Pack2_Event_Sales_14D_v2.csv: 2026-08-18–08-31 급증·둔화·반품 이벤트 · 1,008행','4) VIIMsignal_Pack2_Event_Inventory_14D_v2.csv: 2026-08-18–08-31 부족·잉여·재주문 재고 변화 · 1,176행','- 판매 기준팩과 이벤트팩은 날짜가 겹치지 않습니다.','- VIIMsignal_Closed_Beta_DataPacks_v2_20260901.xlsx: 위 4개 업로드 파일과 업무 검증 기준을 한 번에 보는 통합 문서','- VIIMsignal_Pack3_Workflow_Scenarios.csv, VIIMsignal_Pack3_Production_Events.csv: 기대 결과 확인용이며 직접 업로드하지 않습니다.','','권장 업로드 순서','① 상품 마스터 → ② 기준 판매 → ③ 기준 재고 → ④ 이벤트 판매 → ⑤ 이벤트 재고 → ⑥ 리뷰·VOC','재고 이동·재주문·생산오더는 참고 CSV를 적재하지 않고 서비스 화면에서 승인하여 생성합니다.'].join('\n')+'\n');
console.log(JSON.stringify({salesRows:sales.length-1,inventoryRows:inventory.length-1,reviewRows:reviews.length-1,output},null,2));
