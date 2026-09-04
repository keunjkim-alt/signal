import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SpreadsheetFile,Workbook} from '@oai/artifact-tool';

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,'..');
const sourceDir=path.join(project,'assets/templates/closed-beta');
const scenarioDir=path.join(sourceDir,'scenario-packs');
const outputDir=path.join(project,'outputs/release-1.0-rehearsal-20260904');
const palette={ink:'#171A1F',navy:'#213A5C',blue:'#4776A8',bluePale:'#EAF1F8',line:'#DCE3EA',surface:'#F7F9FB',white:'#FFFFFF',risk:'#B65B55',riskPale:'#F7E9E7',success:'#526F63',successPale:'#EAF0ED'};

const uploadFiles=[
  {sources:[path.join(scenarioDir,'VIIMsignal_Product_SKU_Master_v2.csv')],output:'01_MORROW_Product_Master.xlsx',sheet:'Product_Master',numberFormats:{K:'#,##0',L:'#,##0'}},
  {sources:[path.join(scenarioDir,'VIIMsignal_Pack1_Baseline_Sales_90D_v2.csv'),path.join(scenarioDir,'VIIMsignal_Pack2_Event_Sales_14D_v2.csv')],output:'02_MORROW_Sales_104D.xlsx',sheet:'Sales_104D',numberFormats:{D:'#,##0',E:'#,##0',F:'#,##0',G:'#,##0',H:'#,##0',I:'#,##0',J:'#,##0',K:'#,##0'}},
  {sources:[path.join(scenarioDir,'VIIMsignal_Pack1_Baseline_Inventory_v2.csv'),path.join(scenarioDir,'VIIMsignal_Pack2_Event_Inventory_14D_v2.csv')],output:'03_MORROW_Inventory_15_Snapshots.xlsx',sheet:'Inventory_15D',numberFormats:{E:'#,##0',F:'#,##0',G:'#,##0',H:'#,##0',I:'#,##0',J:'#,##0'}},
  {sources:[path.join(sourceDir,'VIIMsignal_Closed_Beta_Reviews_90D.csv')],output:'04_MORROW_Reviews_90D.xlsx',sheet:'Reviews_90D',numberFormats:{H:'0',K:'#,##0'}}
];

await fs.mkdir(outputDir,{recursive:true});

const manifest=[];
for(const config of uploadFiles){
  const sourceTexts=await Promise.all(config.sources.map(source=>fs.readFile(source,'utf8')));
  const csv=sourceTexts.map((text,index)=>index===0?text.trimEnd():text.split(/\r?\n/).slice(1).join('\n').trimEnd()).join('\n')+'\n';
  const workbook=await Workbook.fromCSV(csv,{sheetName:config.sheet});
  const sheet=workbook.worksheets.getItem(config.sheet);
  const used=sheet.getUsedRange();
  const rows=used.values.length-1;
  const cols=used.values[0]?.length||0;
  sheet.showGridLines=false;
  sheet.freezePanes.freezeRows(1);
  sheet.getRangeByIndexes(0,0,1,cols).format={fill:palette.navy,font:{bold:true,color:palette.white},wrapText:true,borders:{bottom:{style:'medium',color:palette.navy}}};
  if(rows>0)sheet.getRangeByIndexes(1,0,rows,cols).format={font:{color:palette.ink},borders:{insideHorizontal:{style:'thin',color:palette.line}}};
  used.format.autofitColumns();
  used.format.rowHeight=20;
  for(const [column,format] of Object.entries(config.numberFormats))sheet.getRange(`${column}2:${column}${rows+1}`).format.numberFormat=format;
  const target=path.join(outputDir,config.output);
  const output=await SpreadsheetFile.exportXlsx(workbook);
  await output.save(target);
  await fs.writeFile(path.join(outputDir,config.output.replace(/\.xlsx$/i,'.csv')),csv,'utf8');
  const checksum=await sha256(Buffer.from(csv));
  manifest.push({file:config.output,entity:config.sheet,rows,columns:cols,sourceChecksum:checksum.slice(0,16)});
}

const guide=Workbook.create();
const overview=guide.worksheets.add('00_Overview');
overview.showGridLines=false;
overview.getRange('A1:H2').merge();
overview.getRange('A1').values=[['VIIMsignal 1.0 출시 리허설 · MORROW']];
overview.getRange('A1:H2').format={fill:palette.navy,font:{bold:true,color:palette.white,size:20},verticalAlignment:'center'};
overview.getRange('A4:B13').values=[
  ['항목','정의'],
  ['가상 브랜드','MORROW · 여성 컨템포러리 패션'],
  ['리허설 목적','상품·판매·재고·리뷰 적재부터 AX 분석, 승인, 실행, 감사 이력까지 검증'],
  ['분석 기간','2026-05-20 ~ 2026-08-31'],
  ['상품 / SKU','12 / 12'],
  ['판매 채널','자사몰 · 무신사 · 29CM · 네이버 · W컨셉 · 매장 POS'],
  ['운영 위치','온라인몰 · 국내 4개 매장 · 상하이 매장 · 온라인 DC'],
  ['핵심 사건','강남점 ARC-07 품절 위험, 성수점 잉여, AIR-24 전사 부족, MOSS-18 과잉재고'],
  ['고객 신호','배송 지역·익명 고객·재구매·반품·취소 포함'],
  ['리뷰 신호','사이즈·소재·봉제·색상 속성과 응답 필요 상태 포함']
];
styleTable(overview,'A4:B13',2);
overview.getRange('A15:H15').merge();overview.getRange('A15').values=[['권장 업로드 순서']];section(overview,'A15:H15');
overview.getRange('A17:H22').values=uploadFiles.map((file,index)=>[index+1,file.output,file.sheet,manifest[index].rows,'미리보기 → 유형·매핑 확인 → 적재','적재 후 정합성 일치 확인','','']);
overview.getRange('A16:H16').values=[['순서','파일','데이터 유형','행 수','실행','합격 기준','결과','메모']];styleTable(overview,'A16:H22',8);
overview.getRange('D17:D22').format.numberFormat='#,##0';
overview.getRange('A24:H27').values=[
  ['중요','상품 마스터를 먼저 적재해야 재고·리뷰가 SKU/상품과 연결됩니다.','','','','','',''],
  ['중요','기준 판매·재고 후 이벤트 판매·재고를 적재해야 급증·부족·과잉 신호가 생성됩니다.','','','','','',''],
  ['안전','직접 식별정보는 없으며 customer_token은 가상 익명값입니다.','','','','','',''],
  ['범위','목표·마케팅 계획은 1.0 적재 계약 밖이므로 이번 리허설에서 하드코딩 화면만 확인합니다.','','','','','','']
];
overview.getRange('A24:A27').format={fill:palette.bluePale,font:{bold:true,color:palette.navy}};
overview.getRange('B24:H27').merge(true);overview.getRange('A24:H27').format.wrapText=true;
overview.getRange('A:H').format.columnWidth=18;overview.getRange('B:B').format.columnWidth=42;

const scenarios=guide.worksheets.add('01_Test_Scenarios');
const scenarioRows=[
  ['R01','데이터','상품 마스터 적재','01 파일 자동 감지·12행 정상','P0','미실행','', ''],
  ['R02','데이터','90일 판매 기준선 적재','판매 주문·수익성·고객 지역 활성화','P0','미실행','',''],
  ['R03','데이터','기준 재고 적재','12 SKU × 7 위치 연결','P0','미실행','',''],
  ['R04','데이터','14일 이벤트 판매 적재','판매 급증·둔화·반품 신호 생성','P0','미실행','',''],
  ['R05','데이터','14일 이벤트 재고 적재','부족·잉여·재주문 후보 생성','P0','미실행','',''],
  ['R06','데이터','리뷰 90일 적재','고객 인사이트에서 리뷰 속성 집계','P1','미실행','',''],
  ['R07','정합성','원천–DB 합계 검사','판매·재고 모두 일치','P0','미실행','',''],
  ['R08','대시보드','판매 현황 교차 확인','채널·매장·상품 합계가 전체와 일치','P0','미실행','',''],
  ['R09','대시보드','수익성 확인','원가 커버 80% 이상·변동비 커버 50% 이상','P0','미실행','',''],
  ['R10','대시보드','고객·지역·반품 확인','익명고객·재구매·지역·반품이 0보다 큼','P1','미실행','',''],
  ['R11','의사결정','재고 이동 후보 확인','성수 → 강남 ARC-07 후보 생성','P0','미실행','',''],
  ['R12','의사결정','재주문 후보 확인','AIR-24 또는 네트워크 부족 SKU 생성','P0','미실행','',''],
  ['R13','실행','재고 이동 승인','이동 오더·감사 이벤트 생성','P0','미실행','',''],
  ['R14','실행','재주문 승인','생산 실행 큐에 오더 생성','P0','미실행','',''],
  ['R15','AX','정형 질문','고판매·부족재고 질문이 저장 집계를 사용','P1','미실행','',''],
  ['R16','AX','설명 질문','근거·데이터 시점·추천이 표시되고 기록 저장','P1','미실행','',''],
  ['R17','권한','대표 계정','전체 메뉴·수정·승인 가능','P0','미실행','',''],
  ['R18','권한','팀 구성원 계정','허용 메뉴만 표시·승인 차단','P0','미실행','',''],
  ['R19','복구','중복 파일 재업로드','중복으로 표시되고 집계 증가 없음','P1','미실행','',''],
  ['R20','운영','운영 준비도','100점·필수 차단 항목 없음','P0','미실행','',''],
  ['R21','성능','로그인 세션','p95 2초 이내','P0','미실행','',''],
  ['R22','성능','캐시 대시보드','p95 1.5초 이내','P1','미실행','',''],
  ['R23','성능','AX 정형 질문','p95 2초 이내','P1','미실행','',''],
  ['R24','성능','AX 설명 질문','p95 6초 이내·8초 타임아웃 폴백','P1','미실행','','']
];
scenarios.getRange(`A1:H${scenarioRows.length+1}`).values=[['ID','영역','시나리오','합격 기준','우선순위','상태','증거','비고'],...scenarioRows];
styleTable(scenarios,`A1:H${scenarioRows.length+1}`,8);scenarios.freezePanes.freezeRows(1);scenarios.showGridLines=false;
scenarios.getRange(`F2:F${scenarioRows.length+1}`).dataValidation={rule:{type:'list',values:['미실행','통과','실패','차단']}};
scenarios.getRange(`F2:F${scenarioRows.length+1}`).conditionalFormats.add('containsText',{text:'통과',format:{fill:palette.successPale,font:{bold:true,color:palette.success}}});
scenarios.getRange(`F2:F${scenarioRows.length+1}`).conditionalFormats.add('containsText',{text:'실패',format:{fill:palette.riskPale,font:{bold:true,color:palette.risk}}});
scenarios.getRange('A:H').format.columnWidth=18;scenarios.getRange('C:D').format.columnWidth=34;scenarios.getRange('G:H').format.columnWidth=28;

const expected=guide.worksheets.add('02_Expected_Signals');
expected.getRange('A1:H9').values=[
  ['신호','대상 SKU','출발/원인','도착/영향','기대 방향','업무 액션','담당','검증 상태'],
  ['고판매·부족재고','ARC-07-BLK-F','성수점 잉여','강남점 부족','재고 이동 우선','성수→강남 이동 승인','재고운영팀','미실행'],
  ['전사 재고 부족','AIR-24-NVY-F','최근 판매 증가','전 위치 안전재고 하회','재주문 우선','생산오더 생성','생산팀','미실행'],
  ['과잉재고','MOSS-18-BLK-F','판매 둔화','총 가용 1,000pcs 이상','할인 전 비가격 대안','이동·노출·세트 검토','영업팀','미실행'],
  ['반품 위험','EASE-19-CRM-F','사이즈·봉제 리뷰','반품률 상승','상세페이지/품질 개선','VOC 태스크 생성','상품기획팀','미실행'],
  ['소재 VOC','WAVE-31-WHT-F','비침·색상 리뷰','평점 하락','콘텐츠·소재 표기 보완','리뷰 대응 태스크','마케팅팀','미실행'],
  ['채널 수익성','W컨셉·29CM','수수료·광고비','기여이익률 하락','최적 할인 제한','정상가/쿠폰 비교','영업팀','미실행'],
  ['지역 고객','서울·경기·부산','배송지 집계','재구매·AOV 차이','지역별 캠페인 근거','타깃 제안','마케팅팀','미실행'],
  ['감사 추적','승인된 안건','사용자·시각','실행 객체','전 과정 추적','감사 로그 확인','관리자','미실행']
];styleTable(expected,'A1:H9',8);expected.showGridLines=false;expected.freezePanes.freezeRows(1);expected.getRange('A:H').format.columnWidth=20;expected.getRange('A:G').format.wrapText=true;

const release=guide.worksheets.add('03_Release_Gates');
const gateRows=[
  ['G01','실제형 데이터','4개 엔티티 적재·정합성 일치',20,'미실행'],
  ['G02','신규 계정·권한','대표·관리자·팀원 E2E 통과',18,'미실행'],
  ['G03','AX·화면 성능','정의된 p95 기준 통과',15,'미실행'],
  ['G04','재현 배포','GitHub main→Vercel·롤백 검증',15,'미실행'],
  ['G05','운영 안전장치','모니터링·백업·감사·비용 한도',17,'미실행'],
  ['G06','1.0 범위','지원/비지원 연동 UI·문서 일치',15,'미실행']
];release.getRange('A1:F8').values=[['Gate','영역','합격 기준','가중치','상태','점수'],...gateRows,['TOTAL','출시 판정','90점 이상이며 P0 차단 없음',100,'','']];
styleTable(release,'A1:F8',6);release.showGridLines=false;release.getRange('E2:E7').dataValidation={rule:{type:'list',values:['미실행','통과','실패','차단']}};
for(let row=2;row<=7;row++)release.getRange(`F${row}`).formulas=[[`=IF(E${row}="통과",D${row},0)`]];
release.getRange('F8').formulas=[['=SUM(F2:F7)']];release.getRange('D2:F8').format.numberFormat='0';release.getRange('A:F').format.columnWidth=24;release.getRange('C:C').format.columnWidth=42;

const scope=guide.worksheets.add('04_Integration_Scope');
scope.getRange('A1:F11').values=[
  ['연동','1.0 상태','운영 방식','보안·전제','SLA','후속'],
  ['CSV/XLSX','공식 지원','관리자 업로드·미리보기·확인 적재','20MB·원본 비공개 보관','수동 즉시','유지'],
  ['Google Sheets','공식 지원(공개 읽기)','Published CSV 예약/수동 동기화','개인정보 금지','일 1회 또는 수동','OAuth 비공개 시트'],
  ['SFTP 파일','제한 지원','HTTPS 릴레이를 통한 수집','자격증명은 서버 환경변수','계약별','네이티브 SFTP 어댑터'],
  ['WMS API','1.1 예정','현재는 재고 CSV/XLSX 대체','API 계약·필드 매핑 필요','미정','브랜드별 어댑터'],
  ['무신사·29CM·네이버·W컨셉 API','1.1 예정','현재는 채널 판매 파일 업로드','파트너 권한·토큰 필요','미정','공식 API 우선'],
  ['외부 시장 크롤러','1.1 이후','현재는 샘플 관측 데이터','약관·robots·저작권 검토','미정','법무 검토 후'],
  ['다중 브랜드 통합','1.1 이후','1.0은 브랜드 워크스페이스 단위','회사 통합 KPI 정의 필요','미정','포트폴리오 뷰'],
  ['OpenAI AX','공식 지원','집계 우선·복잡 질문만 API','키 서버 저장·8초 폴백','목표 p95 6초','모델/비용 모니터링'],
  ['원본 개인정보','지원하지 않음','익명 customer_token과 지역만','이메일·전화·상세주소 업로드 금지','—','DPA 후 재검토'],
  ['목표·마케팅 계획 적재','1.1 예정','1.0 화면은 샘플/수동 정의','표준 스키마 필요','미정','계획 엔티티 추가']
];styleTable(scope,'A1:F11',6);scope.showGridLines=false;scope.freezePanes.freezeRows(1);scope.getRange('A:F').format.columnWidth=24;scope.getRange('C:D').format.columnWidth=36;scope.getRange('A:F').format.wrapText=true;

const manifestSheet=guide.worksheets.add('05_File_Manifest');
manifestSheet.getRange(`A1:E${manifest.length+1}`).values=[['파일','엔티티','행 수','컬럼 수','원천 체크섬(앞 16자)'],...manifest.map(row=>[row.file,row.entity,row.rows,row.columns,row.sourceChecksum])];
styleTable(manifestSheet,`A1:E${manifest.length+1}`,5);manifestSheet.showGridLines=false;manifestSheet.freezePanes.freezeRows(1);manifestSheet.getRange('A:A').format.columnWidth=44;manifestSheet.getRange('B:E').format.columnWidth=22;

const guidePath=path.join(outputDir,'00_VIIMsignal_1.0_Rehearsal_Guide.xlsx');
const guideOutput=await SpreadsheetFile.exportXlsx(guide);await guideOutput.save(guidePath);
const inspection=await guide.inspect({kind:'table',sheetId:'03_Release_Gates',range:'A1:F8',include:'values,formulas',tableMaxRows:10,tableMaxCols:8,maxChars:5000});
await fs.writeFile(path.join(outputDir,'guide-inspection.ndjson'),inspection.ndjson);
const errors=await guide.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',options:{useRegex:true,maxResults:100},summary:'formula errors'});
await fs.writeFile(path.join(outputDir,'guide-formula-errors.ndjson'),errors.ndjson);
for(const sheetName of ['00_Overview','01_Test_Scenarios','03_Release_Gates','04_Integration_Scope']){
  const preview=await guide.render({sheetName,autoCrop:'all',scale:1,format:'png'});
  await fs.writeFile(path.join(outputDir,`preview-${sheetName}.png`),new Uint8Array(await preview.arrayBuffer()));
}
console.log(JSON.stringify({outputDir,guide:guidePath,uploadFiles:manifest},null,2));

function styleTable(sheet,range,columns){
  const used=sheet.getRange(range),rows=used.values.length;
  sheet.getRangeByIndexes(used.rowIndex,used.columnIndex,1,columns).format={fill:palette.navy,font:{bold:true,color:palette.white},wrapText:true,borders:{bottom:{style:'medium',color:palette.navy}}};
  if(rows>1)sheet.getRangeByIndexes(used.rowIndex+1,used.columnIndex,rows-1,columns).format={font:{color:palette.ink},borders:{insideHorizontal:{style:'thin',color:palette.line}},verticalAlignment:'center'};
  used.format.rowHeight=24;
}
function section(sheet,range){sheet.getRange(range).format={fill:palette.bluePale,font:{bold:true,color:palette.navy,size:13},verticalAlignment:'center'};}
async function sha256(bytes){const {createHash}=await import('node:crypto');return createHash('sha256').update(bytes).digest('hex');}
