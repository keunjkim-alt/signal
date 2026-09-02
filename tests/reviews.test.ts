import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {resolve} from 'node:path';
import {classifyReview,inferReviewMapping,summarizeReviewInsights,validateAndNormalizeReviews} from '../api/_lib/reviews.js';
import {detectEntityType} from '../api/_lib/mapping-templates.js';

test('리뷰 CSV 헤더를 리뷰 데이터로 높은 신뢰도로 감지한다',async()=>{
  const headers=['review_id','reviewed_at','platform','product_code','sku_code','rating','review_text','verified_purchase'];
  const mapping=inferReviewMapping(headers),rows=[{review_id:'R1',reviewed_at:'2026-08-31',platform:'무신사',product_code:'ARC-07-BLK-F',sku_code:'ARC-07-BLK-F',rating:2,review_text:'사이즈가 작게 나와 타이트해요',verified_purchase:true}],validation=validateAndNormalizeReviews(rows,mapping),detection=detectEntityType({product_review:{mapping,validRows:validation.validRows.length,errorRows:validation.errors.length,missingFields:validation.missingFields},sales_order:{mapping:{},validRows:0,errorRows:1,missingFields:['sold_at']}});
  assert.equal(detection.recommended,'product_review');
  assert.equal(detection.confidence,'high');
});

test('한 리뷰에서 복수 속성과 반품 위험을 분류한다',()=>{
  const signals=classifyReview({rating:1,review_text:'사이즈가 작게 나와 타이트하고 봉제 마감도 아쉬워요.'});
  assert.deepEqual(signals.map(row=>row.aspect_code),['fit','quality']);
  assert.ok(signals.every(row=>row.sentiment==='negative'));
  assert.ok(signals.every(row=>row.return_risk));
});

test('리뷰 집계는 평점·부정률·응답 필요·근거를 계산한다',()=>{
  const reviews=[{id:'1',product_id:'p1',reviewed_at:'2026-08-31T00:00:00Z',platform:'무신사',rating:2,review_text:'작아요',seller_response_status:'pending'},{id:'2',product_id:'p1',reviewed_at:'2026-08-30T00:00:00Z',platform:'자사몰',rating:5,review_text:'좋아요',seller_response_status:'responded'}],signals=[{review_id:'1',aspect_code:'fit',aspect_label:'사이즈·핏',sentiment:'negative',severity:2,return_risk:true,recommended_team:'디자인'},{review_id:'2',aspect_code:'design',aspect_label:'디자인',sentiment:'positive',severity:0,return_risk:false,recommended_team:'상품기획'}],summary=summarizeReviewInsights(reviews,signals,[{id:'p1',product_code:'ARC-07',product_name:'Utility Jacket'}]);
  assert.equal(summary.summary.reviews,2);
  assert.equal(summary.summary.averageRating,3.5);
  assert.equal(summary.summary.negativePct,50);
  assert.equal(summary.summary.responseNeeded,1);
  assert.equal(summary.summary.returnRisk,1);
  assert.equal(summary.evidence[0].product_code,'ARC-07');
});

test('클로즈드 베타 리뷰팩은 12개 상품과 480건으로 구성된다',async()=>{
  const path=resolve('assets/templates/closed-beta/VIIMsignal_Closed_Beta_Reviews_90D.csv'),text=await readFile(path,'utf8'),lines=text.trim().split(/\r?\n/),headers=lines[0].split(',');
  assert.equal(lines.length-1,480);
  assert.ok(headers.includes('review_text'));
  assert.equal(new Set(lines.slice(1).map(line=>line.split(',')[4])).size,12);
});
