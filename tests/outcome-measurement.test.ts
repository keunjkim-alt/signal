import test from 'node:test';
import assert from 'node:assert/strict';
import {measureInternalOutcome} from '../api/_lib/outcome-measurement.ts';

const sales=[] as any[];
for(let offset=-28;offset<7;offset++){const date=new Date('2026-09-01T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);const after=offset>=0;sales.push({date:date.toISOString().slice(0,10),quantity:after?8:5,netSales:(after?8:5)*100,unitCostAmount:(after?8:5)*40})}

test('verified internal outcome compares post-execution sales with the preceding 28-day baseline',()=>{
  const result:any=measureInternalOutcome({measurementStartDate:'2026-09-01',measurementEndDate:'2026-09-08',dataStartDate:'2026-08-04',dataWatermarkDate:'2026-09-07',sales,executedQty:30,recommendedQty:40,expectedNetValue:500,expectedLogisticsCost:80});
  assert.equal(result.ready,true);assert.equal(result.actualQty,56);assert.equal(result.baselineQty,35);assert.equal(result.incrementalQty,21);assert.equal(result.realizedRevenueGain,2100);assert.equal(result.realizedMarginGain,1260);assert.equal(result.realizedLogisticsCost,60);assert.equal(result.realizedNetValue,1200);assert.equal(result.quantityErrorPct,25);
});

test('outcome waits until the sales watermark covers the full measurement window',()=>{
  const result:any=measureInternalOutcome({measurementStartDate:'2026-09-01',measurementEndDate:'2026-09-08',dataStartDate:'2026-08-04',dataWatermarkDate:'2026-09-05',sales,executedQty:30,recommendedQty:40,expectedNetValue:500,expectedLogisticsCost:80});
  assert.deepEqual(result,{ready:false,reason:'sales_data_not_complete',requiredWatermark:'2026-09-07'});
});

test('outcome rejects a partial pre-execution baseline',()=>{
  const result:any=measureInternalOutcome({measurementStartDate:'2026-09-01',measurementEndDate:'2026-09-08',dataStartDate:'2026-08-20',dataWatermarkDate:'2026-09-07',sales,executedQty:30,recommendedQty:40,expectedNetValue:500,expectedLogisticsCost:80});
  assert.equal(result.ready,false);assert.equal(result.reason,'insufficient_baseline');
});
