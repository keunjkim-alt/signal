import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {inferMarketingMapping,marketingControlTotals,summarizeMarketingInsights,validateAndNormalizeMarketing} from '../api/_lib/marketing.ts';
import {detectEntityType,mappingFields,requiredMappingFields} from '../api/_lib/mapping-templates.ts';
import {intelligenceMode} from '../api/_lib/semantic.ts';

const headers=['campaign_id','campaign_name','start_at','end_at','channel_code','campaign_type','budget','spend','impressions','clicks','conversions','attributed_sales','control_group_size','control_group_conversions','owner','status','source_updated_at'];

test('campaign upload contract infers and validates operational rows',()=>{
  const mapping=inferMarketingMapping(headers),result=validateAndNormalizeMarketing([{
    campaign_id:'CMP-01',campaign_name:'가을 신상품',start_at:'2026-09-01',end_at:'2026-09-30',channel_code:'musinsa',campaign_type:'launch',budget:'10000000',spend:'4000000',impressions:'100000',clicks:'5000',conversions:'400',attributed_sales:'16000000',control_group_size:'10000',control_group_conversions:'20',owner:'김마케터',status:'진행중',source_updated_at:'2026-09-07 09:00'
  }],mapping);
  assert.equal(result.missingFields.length,0);assert.equal(result.errors.length,0);assert.equal(result.validRows.length,1);assert.equal(result.validRows[0].status,'in_progress');assert.equal(result.validRows[0].channel_code,'MUSINSA');assert.match(result.validRows[0].observed_at,/2026-09-07/);
  assert.deepEqual(marketingControlTotals(result.validRows),{rows:1,campaigns:1,spend:4000000,conversions:400,attributedSales:16000000});
});

test('campaign rows reject impossible ranges and malformed dates',()=>{
  const mapping=inferMarketingMapping(headers),result=validateAndNormalizeMarketing([{campaign_id:'BAD',campaign_name:'오류',start_at:'2026-09-30',end_at:'2026-09-01',channel_code:'OWN',budget:1,spend:2,impressions:10,clicks:20,conversions:30,attributed_sales:1,source_updated_at:'not-a-date'}],mapping);
  assert.equal(result.validRows.length,0);assert.equal(result.errors.length,1);assert.match(result.errors[0].field_name,/end_at|source_updated_at|clicks|conversions/);
});

test('campaign type wins automatic detection with its complete contract',()=>{
  const mapping=inferMarketingMapping(headers),candidates:any={product_master:{mapping:{},validRows:0,errorRows:1,missingFields:['product_code','product_name']},sales_order:{mapping:{channel_code:'channel_code'},validRows:0,errorRows:1,missingFields:['sold_at','sku_code','quantity','net_sales']},inventory_snapshot:{mapping:{},validRows:0,errorRows:1,missingFields:['sku_code','location_code','snapshot_at','available_qty']},product_review:{mapping:{},validRows:0,errorRows:1,missingFields:['review_id']},marketing_campaign:{mapping,validRows:1,errorRows:0,missingFields:[]}};
  const detection=detectEntityType(candidates);assert.equal(detection.recommended,'marketing_campaign');assert.equal(detection.confidence,'high');assert.ok(mappingFields('marketing_campaign').includes('attributed_sales'));assert.ok(requiredMappingFields('marketing_campaign').includes('source_updated_at'));
});

test('marketing insights use the latest snapshot and retain dated trend',()=>{
  const campaigns=[{id:'1',source_campaign_id:'CMP-01',campaign_name:'런칭',channel_code:'MUSINSA',budget:1000,status:'in_progress'},{id:'2',source_campaign_id:'CMP-02',campaign_name:'CRM',channel_code:'OWN',budget:500,status:'completed'}],snapshots=[
    {campaign_id:'1',observed_at:'2026-09-06T00:00:00Z',spend:200,impressions:1000,clicks:100,conversions:10,attributed_sales:600,control_group_size:1000,control_group_conversions:5},
    {campaign_id:'1',observed_at:'2026-09-07T00:00:00Z',spend:400,impressions:2000,clicks:200,conversions:30,attributed_sales:1600,control_group_size:1000,control_group_conversions:5},
    {campaign_id:'2',observed_at:'2026-09-07T00:00:00Z',spend:100,impressions:500,clicks:50,conversions:5,attributed_sales:400}
  ],result=summarizeMarketingInsights(campaigns,snapshots);
  assert.equal(result.hasData,true);assert.equal(result.summary.spend,500);assert.equal(result.summary.attributedSales,2000);assert.equal(result.summary.roas,4);assert.equal(result.campaigns[0].campaign_name,'런칭');assert.equal(result.trend.length,2);assert.ok(result.summary.incrementalSales>0);
});

test('marketing questions are routed to precomputed marketing intelligence',()=>{
  assert.equal(intelligenceMode('캠페인별 ROAS와 예산 초과를 보여줘','marketing'),'marketing');assert.equal(intelligenceMode('어느 광고비를 줄여야 해?','action'),'marketing');
});

test('schema, UI and upload API enforce workspace scoped campaign operations',()=>{
  const migration=readFileSync(new URL('../supabase/migrations/0024_marketing_campaigns.sql',import.meta.url),'utf8'),upload=readFileSync(new URL('../api/uploads/data.ts',import.meta.url),'utf8'),app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  assert.match(migration,/create table if not exists public\.marketing_campaigns/);assert.match(migration,/create table if not exists public\.marketing_campaign_snapshots/);assert.match(migration,/is_workspace_member\(workspace_id\)/);assert.match(migration,/unique nulls not distinct \(organization_id,workspace_id,campaign_id,observed_at\)/);assert.match(upload,/ingestMarketing/);assert.match(upload,/marketing_campaign/);assert.match(app,/marketingConnectedDashboard/);assert.match(app,/refreshMarketingInsights/);assert.match(app,/마케팅·캠페인 · CSV\/XLSX/);
});
