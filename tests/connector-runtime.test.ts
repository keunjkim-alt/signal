import test from 'node:test';
import assert from 'node:assert/strict';
import {credentialRegistry,googleSheetCsvUrl,probeConnector,pullConnectorFile} from '../api/_lib/connector-runtime.ts';
import {storageSafeFilename} from '../api/uploads/data.ts';

test('Google Sheets URL is converted to a bounded CSV export URL',()=>{
  const url=new URL(googleSheetCsvUrl({spreadsheet_url:'https://docs.google.com/spreadsheets/d/abc_123/edit',sheet_range:"상품 마스터!A:L"}));
  assert.equal(url.hostname,'docs.google.com');assert.equal(url.searchParams.get('sheet'),'상품 마스터');assert.equal(url.searchParams.get('range'),'A:L');
});

test('Google Sheets CSV response strips charset from the storage MIME type',async()=>{
  const source={source_type:'sheet',name:'재고 시트',config:{entity_type:'inventory_snapshot',connection:{spreadsheet_url:'https://docs.google.com/spreadsheets/d/abc_123/edit',sheet_range:'재고!A:J'}}};
  const fetchImpl:any=async()=>new Response('sku_code,location_code,snapshot_at,available_qty\nA1,S1,2026-08-27,5',{headers:{'content-type':'text/csv; charset=utf-8'}});
  const file=await pullConnectorFile(source,{fetchImpl});
  assert.equal(file.type,'text/csv');
});

test('connector filenames use an ASCII-safe storage key while keeping the CSV extension',()=>{
  assert.equal(storageSafeFilename('베타_재고_Google_Sheets.csv'),'Google_Sheets.csv');
  assert.equal(storageSafeFilename('재고 스냅샷'),'source-data.csv');
});

test('channel API JSON rows are converted to an importable CSV file',async()=>{
  const source={source_type:'api',provider:'naver',name:'네이버',config:{entity_type:'sales_order',connection:{credential_ref:'naver-prod',merchant_id:'shop-1'}}},credentials=JSON.stringify({'naver-prod':{kind:'channel_api',endpoint:'https://connector.example/orders',token:'server-only',response_path:'data.orders'}}),calls:any[]=[];
  const fetchImpl:any=async(url:string,options:any)=>{calls.push({url,options});return new Response(JSON.stringify({data:{orders:[{sold_at:'2026-08-27',channel_code:'NAVER',sku_code:'A1',quantity:2,net_sales:10000}]}}),{headers:{'content-type':'application/json'}})};
  const file=await pullConnectorFile(source,{fetchImpl,credentialsRaw:credentials}),text=await file.text();
  assert.match(text,/sold_at,channel_code,sku_code,quantity,net_sales/);assert.match(calls[0].options.headers.authorization,/Bearer/);assert.equal(calls[0].url.includes('merchant_id=shop-1'),true);
});

test('SFTP source uses only a server-side relay credential',async()=>{
  const source={source_type:'sftp',name:'WMS',config:{entity_type:'inventory_snapshot',connection:{host:'wms.internal',port:22,remote_path:'/export/*.csv',credential_ref:'wms-prod'}}},credentials=JSON.stringify({'wms-prod':{kind:'sftp_relay',endpoint:'https://relay.example/pull',token:'secret'}}),fetchImpl:any=async(_url:string,options:any)=>{const body=JSON.parse(options.body);assert.equal(body.host,'wms.internal');assert.equal(body.remote_path,'/export/*.csv');return new Response('sku_code,location_code,snapshot_at,available_qty\nA1,S1,2026-08-27,5',{headers:{'content-type':'text/csv'}})};
  const probe=await probeConnector(source,{fetchImpl,credentialsRaw:credentials});assert.equal(probe.reachable,true);assert.deepEqual(probe.headers,['sku_code','location_code','snapshot_at','available_qty']);
});

test('credential registry rejects malformed server configuration',()=>{assert.throws(()=>credentialRegistry('[]'),/JSON/)});
