import test from 'node:test';
import assert from 'node:assert/strict';
import {appliedLearningProfiles,deriveForecastBiasCandidates,learningMultiplier} from '../api/_lib/policy-learning.ts';

const line={id:'line',sku_id:'sku',to_location_id:'store'};
const outcome=(id:string,actual:number,baseline:number,net=100)=>({id,execution_request_id:`execution-${id}`,recommendation_line_id:'line',outcome_status:'complete',learning_eligible:true,measurement_start_date:'2026-08-01',measurement_end_date:'2026-08-29',realized_sales_qty:actual,realized_net_value:net,metrics:{baselineQty:baseline}});

test('learning waits for three independent D+28 outcomes',()=>{assert.equal(deriveForecastBiasCandidates([outcome('1',120,100),outcome('2',110,100)],[line]).length,0)});
test('learning shrinks demand bias and caps automatic influence',()=>{const [candidate]=deriveForecastBiasCandidates([outcome('1',150,100),outcome('2',140,100),outcome('3',160,100)],[line]);assert.equal(candidate.evidenceCount,3);assert.equal(candidate.proposedValue.multiplier,1.1875);assert.ok(candidate.confidence<.7)});
test('only applied policy candidates affect future forecasts',()=>{const rows=[{id:'a',candidate_type:'forecast_bias',status:'proposed',sku_id:'sku',location_id:'store',proposed_value:{multiplier:1.2},confidence:.8,evidence_count:4},{id:'b',candidate_type:'forecast_bias',status:'applied',sku_id:'sku2',location_id:'store',proposed_value:{multiplier:2},confidence:.8,evidence_count:6}],profiles=appliedLearningProfiles(rows);assert.equal(learningMultiplier(profiles,'sku','store').multiplier,1);assert.equal(learningMultiplier(profiles,'sku2','store').multiplier,1.2)});
