import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectConnectorDraft,normalizeConnectorDraft} from '../api/_lib/connector-config.ts';

test('Google Sheets connector keeps only operational non-secret configuration',()=>{
  const draft=normalizeConnectorDraft({source_type:'sheet',name:'상품 마스터',entity_type:'product_master',spreadsheet_url:'https://docs.google.com/spreadsheets/d/abc_123/edit',sheet_range:'products!A:Q',api_key:'must-not-persist'});
  assert.equal(draft.provider,'google_sheets');
  assert.equal(draft.config.connection.sheet_range,'products!A:Q');
  assert.equal('api_key' in draft.config.connection,false);
});

test('SFTP connector requires a server-side credential reference',()=>{
  assert.throws(()=>normalizeConnectorDraft({source_type:'sftp',name:'WMS',entity_type:'inventory_snapshot',host:'wms.example.com',remote_path:'/exports/*.csv'}),/자격증명/);
  const result=inspectConnectorDraft({source_type:'sftp',name:'WMS',entity_type:'inventory_snapshot',host:'wms.example.com',remote_path:'/exports/*.csv',credential_ref:'wms-prod'});
  assert.equal(result.valid,true);
  assert.equal(result.activation,'registered_pending_sync');
});

test('channel API connector rejects unsupported providers and never accepts raw secrets',()=>{
  assert.throws(()=>normalizeConnectorDraft({source_type:'api',provider:'unknown',name:'Unknown',entity_type:'sales_order',account_label:'shop',credential_ref:'secret-ref'}),/지원하지 않는 채널/);
  const draft=normalizeConnectorDraft({source_type:'api',provider:'naver',name:'네이버',entity_type:'sales_order',account_label:'브랜드 스토어',credential_ref:'naver-prod',password:'not-stored'});
  assert.deepEqual(Object.keys(draft.config.connection).sort(),['account_label','credential_ref','merchant_id']);
});
