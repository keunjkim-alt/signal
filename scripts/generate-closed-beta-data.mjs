import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url)),output=resolve(here,'../assets/templates/closed-beta');
mkdirSync(output,{recursive:true});

const products=[
  ['ARC-07-BLK-F','Utility Jacket','OUTER',248000,82000],['FLOW-22-BLK-F','Drape Pants','BOTTOM',158000,51000],['EASE-19-IVY-F','Layer Top','TOP',89000,27000],['CORE-08-GRY-F','Core Knit','TOP',119000,39000],
  ['AIR-24-NVY-F','Volume Dress','DRESS',198000,65000],['FRAME-31-DNM-F','Denim Dress','DRESS',228000,78000],['SHEER-15-WHT-F','Sheer Layer Top','TOP',99000,31000],['FORM-12-BLK-F','Relaxed Blazer','OUTER',268000,91000]
];
const channels=[['자사몰','ONLINE','온라인몰',.04,.035],['무신사','ONLINE','온라인몰',.12,.045],['29CM','ONLINE','온라인몰',.14,.04],['네이버','ONLINE','온라인몰',.08,.025],['W컨셉','ONLINE','온라인몰',.15,.035],['매장 POS','STORE-SEONGSU','성수 플래그십',.02,.01]];
const regions=[['서울','성동구'],['서울','강남구'],['경기','성남시'],['부산','해운대구'],['인천','연수구'],['대구','수성구']];
const salesHeaders=['sold_at','channel_code','sku_code','quantity','net_sales','unit_cost','channel_fee','marketing_cost','shipping_cost','return_cost','returned_quantity','location_code','location_name','product_name','category','order_id','line_id','country_code','currency_code','customer_token','shipping_region_1','shipping_region_2','order_status'];
const sales=[salesHeaders];
for(let day=0;day<30;day++)for(let p=0;p<products.length;p++)for(let c=0;c<channels.length;c++){
  const [sku,name,category,listPrice,unitCost]=products[p],[channel,locationCode,locationName,feeRate,marketingRate]=channels[c],date=new Date(Date.UTC(2026,7,23-day,10+(p+c+day)%12,(p*11+c*7)%60));
  const quantity=Math.max(1,Math.round((4+p*1.4+c*.8)*(1+Math.sin((day+p+c)/3)*.28))),discount=[.03,.12,.1,.06,.14,.02][c],cancelled=(day*13+p*7+c)%79===0,returned=cancelled?0:((day+p+c)%17===0?Math.max(1,Math.round(quantity*.2)):0),salePrice=Math.round(listPrice*(1-discount)),netSales=cancelled?0:quantity*salePrice,region=regions[(day+p+c)%regions.length],customer=`CUST-${String((day*37+p*11+c*5)%420+1).padStart(4,'0')}`;
  sales.push([date.toISOString(),channel,sku,quantity,netSales,unitCost,Math.round(netSales*feeRate),Math.round(netSales*marketingRate),channel==='매장 POS'?0:3500,returned?Math.round(returned*salePrice*.04):0,returned,locationCode,locationName,name,category,`BETA-${String(day).padStart(2,'0')}-${p}-${c}`,'1',channel==='매장 POS'&&day%11===0?'CN':'KR','KRW',customer,region[0],region[1],cancelled?'cancelled':'paid']);
}

const inventoryHeaders=['sku_code','location_code','location_name','snapshot_at','on_hand_qty','reserved_qty','available_qty','in_transit_qty','damaged_qty','safety_stock_qty'],inventory=[inventoryHeaders],locations=[['ONLINE','온라인몰'],['STORE-SEONGSU','성수 플래그십'],['STORE-GANGNAM','강남점'],['STORE-HANNAM','한남점'],['STORE-BUSAN','부산 센텀'],['STORE-SHANGHAI','상하이 IFC'],['DC-ONLINE','온라인 DC']];
for(let p=0;p<products.length;p++)for(let l=0;l<locations.length;l++){
  const available=45+p*31+l*19+(p===0&&l===2?-38:0)+(p===1&&l===1?210:0),reserved=(p+l)%13,onHand=available+reserved,inTransit=(p+l)%4===0?40:0;
  inventory.push([products[p][0],locations[l][0],locations[l][1],'2026-08-24T09:00:00+09:00',onHand,reserved,available,inTransit,(p+l)%9===0?2:0,35+p*3]);
}

const csv=rows=>rows.map(row=>row.map(value=>{const text=String(value??'');return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text}).join(',')).join('\n')+'\n';
writeFileSync(resolve(output,'VIIMsignal_Closed_Beta_Sales_30D.csv'),csv(sales));
writeFileSync(resolve(output,'VIIMsignal_Closed_Beta_Inventory.csv'),csv(inventory));
writeFileSync(resolve(output,'README.txt'),['VIIMsignal 클로즈드 베타 연결형 데이터팩','1) Sales_30D 파일을 판매 주문으로 미리보기·적재합니다.','2) Inventory 파일을 재고 스냅샷으로 미리보기·적재합니다.','3) 판매 현황, 수익성·할인, 고객·지역, 반품·취소, 재고 운영, 오늘 결정할 일을 확인합니다.','직접 식별정보는 없으며 customer_token은 가상의 익명 ID입니다.'].join('\n')+'\n');
console.log(JSON.stringify({salesRows:sales.length-1,inventoryRows:inventory.length-1,output},null,2));
