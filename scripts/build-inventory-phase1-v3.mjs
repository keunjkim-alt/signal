import fs from 'node:fs/promises';
import path from 'node:path';
import {SpreadsheetFile,Workbook} from '@oai/artifact-tool';

const outputDir=path.resolve(process.cwd(),'outputs/inventory-phase1-v3');
await fs.mkdir(outputDir,{recursive:true});

const workbook=Workbook.create();
const colors={navy:'#172554',blue:'#2563EB',sky:'#DBEAFE',ink:'#172033',muted:'#64748B',line:'#CBD5E1',green:'#DCFCE7',amber:'#FEF3C7',red:'#FEE2E2',white:'#FFFFFF',paper:'#F8FAFC'};
const start=new Date('2026-05-01T00:00:00+09:00');
const addDays=(date,days)=>new Date(date.getTime()+days*86400000);
const isoDate=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const styles=[
  ['ARC-07','Utility Jacket','OUTER','JACKET','2026FW','BLACK',248000,82000,'A'],
  ['FLOW-22','Drape Pants','BOTTOM','PANTS','2026FW','BLACK',158000,51000,'A'],
  ['EASE-19','Layer Top','TOP','TOP','2026FW','CREAM',89000,27000,'B'],
  ['AIR-24','Volume Dress','DRESS','DRESS','2026FW','NAVY',198000,65000,'A'],
  ['MOSS-18','Volume Bermuda','BOTTOM','SHORTS','2026FW','BLACK',129000,42000,'C']
];
const sizes=['S','M','L','XL'];
const sizeFactor={S:.85,M:1.18,L:1.08,XL:.64};
const locations=[
  ['STORE-SEONGSU','성수 플래그십','store','KR','서울',1.12],
  ['STORE-GANGNAM','강남점','store','KR','서울',1.28],
  ['STORE-HANNAM','한남점','store','KR','서울',.86],
  ['STORE-BUSAN','부산 센텀','store','KR','부산',.94],
  ['DC-ONLINE','온라인 DC','online_dc','KR','경기',1.42]
];
const products=[];
for(const [style,name,c1,c2,season,color,price,cost,abc] of styles)for(const size of sizes)products.push([style,name,`${style}-${color.slice(0,3)}-${size}`,c1,c2,season,color,size,price,cost,abc,['M','L'].includes(size),'2026-08-01','2026-11-30','active']);

const dailySales=[];
for(let d=0;d<120;d++)for(let p=0;p<products.length;p++)for(let l=0;l<locations.length;l++){
  const [style,name,sku,c1,,,,size,price,cost]=products[p],date=addDays(start,d),seasonRamp=d<65?.52:d<90?.82:1.18,weekend=[0,6].includes(date.getUTCDay())?1.18:1,trend=1+Math.sin((d+p*2+l)/7)*.17,event=d>=102&&d<=108?(style==='ARC-07'?1.7:style==='FLOW-22'?1.35:1):1,slow=style==='MOSS-18'&&d>85?.58:1,base=(p%4+2)*locations[l][5]*sizeFactor[size],quantity=Math.max(0,Math.round(base*seasonRamp*weekend*trend*event*slow)),discount=style==='MOSS-18'&&d>95?.15:0,unitSale=Math.round(price*(1-discount)),returned=Math.max(0,(d+p+l)%43===0?1:0),netQty=Math.max(0,quantity-returned),channel=l===4?'D2C':'STORE_POS';
  dailySales.push([isoDate(date),channel,sku,style,locations[l][0],quantity,returned,netQty,price,unitSale,netQty*unitSale,cost,discount,event>1?'LAUNCH_PUSH':discount?'MARKDOWN_15':'NONE',`DS-${d}-${p}-${l}`]);
}

const inventory=[];
for(let d=0;d<45;d++)for(let p=0;p<products.length;p++)for(let l=0;l<locations.length;l++){
  const [style,,sku,,,,,size]=products[p],date=addDays(new Date('2026-07-18T00:00:00+09:00'),d),risk=style==='ARC-07'&&locations[l][0]==='STORE-GANGNAM'?Math.max(0,58-d*2.2):style==='FLOW-22'&&locations[l][0]==='STORE-BUSAN'?Math.max(0,52-d*1.8):style==='AIR-24'&&locations[l][0]==='STORE-SEONGSU'&&d>=28?Math.max(4,42-(d-28)*2.5):null,surplus=style==='ARC-07'&&locations[l][0]==='STORE-SEONGSU'?260-d*.6:style==='FLOW-22'&&locations[l][0]==='STORE-HANNAM'?240-d*.5:style==='AIR-24'&&locations[l][0]==='DC-ONLINE'?210-d*.4:null,overstock=style==='MOSS-18'?190-d*.45:null,normal=90+(p%5)*13+l*9-d*.7+(d===24?55:0),available=Math.max(0,Math.round((risk??surplus??overstock??normal)*sizeFactor[size])),reserved=(d+p+l)%7,onHand=available+reserved,damaged=(d+p+l)%53===0?1:0,inTransit=(d>=31&&d<34&&style==='ARC-07'&&locations[l][0]==='STORE-GANGNAM')?12:0,safety=Math.round((style==='ARC-07'||style==='FLOW-22'?28:18)*sizeFactor[size]);
  inventory.push([isoDate(date),sku,style,locations[l][0],onHand,reserved,available,inTransit,damaged,0,safety,'v3-synthetic']);
}

const transfers=[
  ['TR-260820-001','ARC-07-BLA-M','STORE-SEONGSU','STORE-GANGNAM',40,36,36,36,'2026-08-20T09:10:00+09:00','2026-08-20T10:00:00+09:00','2026-08-20T15:20:00+09:00','2026-08-21T10:30:00+09:00','received',78000,12000,8000,0,'NORMAL'],
  ['TR-260821-002','ARC-07-BLA-L','STORE-SEONGSU','STORE-GANGNAM',32,32,32,31,'2026-08-21T09:05:00+09:00','2026-08-21T09:45:00+09:00','2026-08-21T16:10:00+09:00','2026-08-22T11:40:00+09:00','received',72000,10000,7000,1,'QTY_DIFF'],
  ['TR-260822-003','FLOW-22-BLA-M','STORE-HANNAM','STORE-BUSAN',48,48,48,48,'2026-08-22T08:30:00+09:00','2026-08-22T09:20:00+09:00','2026-08-22T14:00:00+09:00','2026-08-23T13:10:00+09:00','received',95000,14000,9000,0,'NORMAL'],
  ['TR-260824-004','FLOW-22-BLA-L','STORE-HANNAM','STORE-BUSAN',40,36,36,36,'2026-08-24T09:00:00+09:00','2026-08-24T10:10:00+09:00','2026-08-24T16:30:00+09:00','2026-08-26T10:00:00+09:00','received',92000,12000,8000,0,'DELAY_1D'],
  ['TR-260826-005','EASE-19-CRE-M','DC-ONLINE','STORE-GANGNAM',24,24,24,24,'2026-08-26T10:00:00+09:00','2026-08-26T10:40:00+09:00','2026-08-26T15:10:00+09:00','2026-08-27T09:50:00+09:00','received',65000,9000,7000,0,'NORMAL'],
  ['TR-260828-006','AIR-24-NAV-M','DC-ONLINE','STORE-SEONGSU',20,20,20,20,'2026-08-28T09:30:00+09:00','2026-08-28T10:00:00+09:00','2026-08-28T13:20:00+09:00','2026-08-29T10:00:00+09:00','received',62000,8000,6000,0,'NORMAL']
];
const asExcelLocalDate=value=>{const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);return match?new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]))):null};
const transferRows=transfers.map(row=>row.map((value,index)=>index>=8&&index<=11?asExcelLocalDate(value):value));
const inbounds=[
  ['PO-260701-001','SUP-A','ARC-07-BLA-M',300,'2026-07-01','2026-07-22','2026-07-23',300,'received',100,'SEA',82000],
  ['PO-260701-002','SUP-A','ARC-07-BLA-L',260,'2026-07-01','2026-07-22','2026-07-24',258,'received',100,'SEA',82000],
  ['PO-260710-003','SUP-B','FLOW-22-BLA-M',400,'2026-07-10','2026-07-27','2026-07-27',400,'received',100,'TRUCK',51000],
  ['PO-260710-004','SUP-B','FLOW-22-BLA-L',360,'2026-07-10','2026-07-27','2026-07-29',360,'received',100,'TRUCK',51000],
  ['PO-260718-005','SUP-C','EASE-19-CRE-M',500,'2026-07-18','2026-08-08','2026-08-09',500,'received',200,'SEA',27000],
  ['PO-260720-006','SUP-C','AIR-24-NAV-M',280,'2026-07-20','2026-08-12','2026-08-16',276,'received',100,'SEA',65000],
  ['PO-260801-007','SUP-D','MOSS-18-BLA-M',420,'2026-08-01','2026-08-20','2026-08-20',420,'received',100,'TRUCK',42000],
  ['PO-260815-008','SUP-A','ARC-07-BLA-XL',200,'2026-08-15','2026-09-05','',0,'open',100,'SEA',82000]
];
const inventoryPolicies=styles.map(([style,,,,,,,,abc])=>[style,abc,abc==='A'?.95:abc==='B'?.9:.85,'M|L',abc==='A'?14:10,abc==='A'?8:12,4,24,abc==='A'?150000:80000,true]);
const costPolicies=[
  ['SEOUL_TO_SEOUL',50000,700,300,250,'KRW','2026-08-01'],
  ['SEOUL_TO_BUSAN',80000,800,350,300,'KRW','2026-08-01'],
  ['DC_TO_SEOUL',45000,600,250,200,'KRW','2026-08-01'],
  ['DEFAULT',90000,900,400,350,'KRW','2026-08-01']
];
const expected=[
  ['BT-001','2026-08-18','ARC-07-BLA-M','STORE-SEONGSU','STORE-GANGNAM',36,'Critical','transfer','출발지 잉여·도착지 품절위험·서울권 익일 이동'],
  ['BT-002','2026-08-20','ARC-07-BLA-L','STORE-SEONGSU','STORE-GANGNAM',31,'Critical','transfer','수량차이 1개가 outcome에 반영되어야 함'],
  ['BT-003','2026-08-21','FLOW-22-BLA-M','STORE-HANNAM','STORE-BUSAN',48,'High','transfer','도착 ETA와 부산 운송비 반영'],
  ['BT-004','2026-08-23','FLOW-22-BLA-L','STORE-HANNAM','STORE-BUSAN',36,'High','transfer','1일 지연 위험비용 반영'],
  ['BT-005','2026-08-25','MOSS-18-BLA-M','','',0,'Low','hold','과잉이나 품절 이동 대상이 아님'],
  ['BT-006','2026-08-27','AIR-24-NAV-M','DC-ONLINE','STORE-SEONGSU',20,'High','transfer','이동 실행 전 as-of · 확정 입고와 이동중 수량 중복 금지']
];

const addSheet=(name,headers,rows,widths={})=>{
  const sheet=workbook.worksheets.add(name);sheet.showGridLines=false;sheet.freezePanes.freezeRows(1);
  sheet.getRangeByIndexes(0,0,1,headers.length).values=[headers];
  if(rows.length)sheet.getRangeByIndexes(1,0,rows.length,headers.length).values=rows;
  const used=sheet.getRangeByIndexes(0,0,rows.length+1,headers.length);
  used.format.font={name:'Aptos',size:10,color:colors.ink};
  sheet.getRangeByIndexes(0,0,1,headers.length).format={fill:colors.navy,font:{name:'Aptos Display',size:10,bold:true,color:colors.white},rowHeight:26,wrapText:true};
  used.format.borders={insideHorizontal:{style:'thin',color:'#E2E8F0'}};
  for(let c=0;c<headers.length;c++)sheet.getRangeByIndexes(0,c,rows.length+1,1).format.columnWidth=widths[c]||14;
  if(rows.length>1)sheet.tables.add(`A1:${String.fromCharCode(64+headers.length)}${rows.length+1}`,true,`${name.replace(/[^A-Za-z0-9]/g,'')}Table`).style='TableStyleMedium2';
  return sheet;
};

const summary=workbook.worksheets.add('README');summary.showGridLines=false;
summary.getRange('A1:H2').merge();summary.getRange('A1').values=[['VIIMsignal Inventory Intelligence · Phase 1 Backtest Data Pack v3']];summary.getRange('A1:H2').format={fill:colors.navy,font:{name:'Aptos Display',size:20,bold:true,color:colors.white},verticalAlignment:'center'};
summary.getRange('A4:B9').values=[['Dataset','Value'],['Styles',styles.length],['SKUs',products.length],['Locations',locations.length],['Sales history (days)',120],['Inventory history (days)',45]];
summary.getRange('D4:E10').values=[['Readiness item','Status'],['Multi-size products','PASS'],['30+ day inventory','PASS'],['Movement history & cost','PASS'],['Inbound lead time','PASS'],['Inventory policies','PASS'],['External data','NOT REQUIRED']];
summary.getRange('A12:H17').values=[['사용 순서','','','','','','',''],['1','Product_Master에서 스타일·컬러·사이즈 구조 확인','','','','','',''],['2','Daily_Sales와 Inventory_Daily를 as-of 기준으로 분할','','','','','',''],['3','Inbound_Orders를 미래 가용재고에 반영','','','','','',''],['4','Inventory_Policies와 Cost_Policies로 이동 제약·비용 계산','','','','','',''],['5','Backtest_Expected와 신규 알고리즘 결과 비교','','','','','','']];
summary.getRange('A12:H12').merge();summary.getRange('A12').format={fill:colors.sky,font:{bold:true,color:colors.navy}};
summary.getRange('A4:B4').format={fill:colors.blue,font:{bold:true,color:colors.white}};summary.getRange('D4:E4').format={fill:colors.blue,font:{bold:true,color:colors.white}};
summary.getRange('A1:H17').format.font={name:'Aptos',size:10,color:colors.ink};summary.getRange('A1').format.font={name:'Aptos Display',size:20,bold:true,color:colors.white};summary.getRange('A:A').format.columnWidth=24;summary.getRange('B:B').format.columnWidth=22;summary.getRange('C:C').format.columnWidth=4;summary.getRange('D:D').format.columnWidth=26;summary.getRange('E:E').format.columnWidth=18;summary.getRange('F:H').format.columnWidth=14;

const productSheet=addSheet('Product_Master',['product_code','product_name','sku_code','category_l1','category_l2','season','color','size','list_price','unit_cost','abc_class','core_size','launch_date','season_end_date','status'],products,{1:24,2:22});
productSheet.getRange(`I2:J${products.length+1}`).format.numberFormat='#,##0';
const salesSheet=addSheet('Daily_Sales',['sales_date','channel_code','sku_code','product_code','location_code','quantity','returned_quantity','net_quantity','list_price','unit_sale_price','net_sales','unit_cost','discount_rate','promotion_code','source_line_id'],dailySales,{0:12,2:20,4:20,13:18,14:20});
salesSheet.getRange(`A2:A${dailySales.length+1}`).format.numberFormat='yyyy-mm-dd';salesSheet.getRange(`I2:L${dailySales.length+1}`).format.numberFormat='#,##0';salesSheet.getRange(`M2:M${dailySales.length+1}`).format.numberFormat='0%';
const inventorySheet=addSheet('Inventory_Daily',['snapshot_date','sku_code','product_code','location_code','on_hand_qty','reserved_qty','available_qty','in_transit_qty','damaged_qty','blocked_qty','uploaded_safety_stock_qty','source'],inventory,{0:12,1:20,3:20});
inventorySheet.getRange(`A2:A${inventory.length+1}`).format.numberFormat='yyyy-mm-dd';inventorySheet.getRange(`E2:K${inventory.length+1}`).format.numberFormat='#,##0';
const transferSheet=addSheet('Transfer_History',['transfer_id','sku_code','from_location','to_location','requested_qty','approved_qty','shipped_qty','received_qty','requested_at','approved_at','shipped_at','received_at','status','transport_cost','handling_cost','receiving_cost','damaged_qty','exception_code'],transferRows,{0:18,1:20,2:20,3:20,8:22,9:22,10:22,11:22,17:16});
transferSheet.getRange(`N2:P${transfers.length+1}`).format.numberFormat='#,##0';
transferSheet.getRange(`I2:L${transfers.length+1}`).format.numberFormat='yyyy-mm-dd hh:mm';
const inboundSheet=addSheet('Inbound_Orders',['po_id','supplier_code','sku_code','ordered_qty','ordered_date','promised_date','received_date','received_qty','status','moq','transport_mode','unit_cost'],inbounds,{0:18,2:20});
inboundSheet.getRange(`E2:G${inbounds.length+1}`).format.numberFormat='yyyy-mm-dd';inboundSheet.getRange(`D2:D${inbounds.length+1}`).format.numberFormat='#,##0';inboundSheet.getRange(`H2:J${inbounds.length+1}`).format.numberFormat='#,##0';inboundSheet.getRange(`L2:L${inbounds.length+1}`).format.numberFormat='#,##0';
const policySheet=addSheet('Inventory_Policies',['product_code','abc_class','target_service_level','core_sizes','min_cover_days','min_transfer_qty','pack_qty','recommendation_ttl_hours','min_net_value_krw','transfer_allowed'],inventoryPolicies,{0:18,3:18});
policySheet.getRange(`C2:C${inventoryPolicies.length+1}`).format.numberFormat='0%';policySheet.getRange(`I2:I${inventoryPolicies.length+1}`).format.numberFormat='#,##0';
const costSheet=addSheet('Cost_Policies',['route_group','base_transport_cost','picking_cost_per_unit','packing_cost_per_unit','receiving_cost_per_unit','currency_code','effective_from'],costPolicies,{0:22});
costSheet.getRange(`B2:E${costPolicies.length+1}`).format.numberFormat='#,##0';costSheet.getRange(`G2:G${costPolicies.length+1}`).format.numberFormat='yyyy-mm-dd';
addSheet('Backtest_Expected',['scenario_id','as_of_date','sku_code','from_location','to_location','expected_qty','expected_risk','expected_action','validation_note'],expected,{0:16,2:20,3:20,4:20,8:46});

summary.freezePanes.freezeRows(2);
const inspect=await workbook.inspect({kind:'table',range:'README!A1:H17',include:'values,formulas',tableMaxRows:20,tableMaxCols:10});
console.log(inspect.ndjson);
const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{useRegex:true,maxResults:100},summary:'formula error scan'});
console.log(errors.ndjson);
const previewRanges={README:'A1:H17',Product_Master:'A1:O16',Daily_Sales:'A1:O18',Inventory_Daily:'A1:L18',Transfer_History:'A1:R8',Inbound_Orders:'A1:L10',Inventory_Policies:'A1:J7',Cost_Policies:'A1:G6',Backtest_Expected:'A1:I8'};
for(const [sheetName,range] of Object.entries(previewRanges)){
  const preview=await workbook.render({sheetName,range,scale:sheetName==='README'?1.5:.8,format:'png'});
  await fs.writeFile(`${outputDir}/preview-${sheetName}.png`,new Uint8Array(await preview.arrayBuffer()));
}
const output=await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/VIIMsignal_Inventory_Phase1_Backtest_DataPack_v3.xlsx`);
console.log(JSON.stringify({output:`${outputDir}/VIIMsignal_Inventory_Phase1_Backtest_DataPack_v3.xlsx`,rows:{products:products.length,dailySales:dailySales.length,inventory:inventory.length,transfers:transfers.length,inbounds:inbounds.length,policies:inventoryPolicies.length,costPolicies:costPolicies.length,expected:expected.length}},null,2));
