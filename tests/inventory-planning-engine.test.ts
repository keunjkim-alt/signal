import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastDemand} from '../api/_lib/demand-forecast.ts';
import {calculateInventoryPosition} from '../api/_lib/inventory-position.ts';
import {optimizeRebalancing} from '../api/_lib/rebalancing-optimizer.ts';
import {measureRecommendationOutcome} from '../api/_lib/recommendation-outcome.ts';

test('demand forecast weights recent demand and includes lost-demand uplift in every quantile',()=>{
  const forecast=forecastDemand({history:[...Array(21).fill(5),...Array(7).fill(10)],horizonDays:7,lostDemandUpliftRate:.1});
  assert.equal(Math.round(forecast.dailyMean*100)/100,9.35);
  assert.ok(forecast.p10Qty<=forecast.p50Qty);
  assert.ok(forecast.p50Qty<=forecast.p90Qty);
  assert.equal(Math.round(forecast.p50Qty*100)/100,65.45);
  assert.equal(Math.round(forecast.lostDemandUpliftQty*100)/100,5.95);
});

test('inventory position includes confirmed inbound and open transfers without double counting damaged stock',()=>{
  assert.deepEqual(calculateInventoryPosition({onHandQty:100,reservedQty:10,damagedQty:5,inboundConfirmedQty:20,transferInQty:8,transferOutQty:3,safetyStockQty:25}),{
    onHandQty:100,reservedQty:10,availableQty:85,inboundConfirmedQty:20,transferInQty:8,transferOutQty:3,damagedQty:5,safetyStockQty:25,inventoryPositionQty:110,stockoutFlag:false
  });
});

test('optimizer respects destination capacity and pack quantity instead of over-recommending',()=>{
  const [recommendation]=optimizeRebalancing([
    {skuId:'ARC-07-M',locationId:'DC',availableQty:200,forecastP90Qty:70,safetyStockQty:50,packQty:12,minTransferQty:12,unitMargin:50000},
    {skuId:'ARC-07-M',locationId:'STORE',availableQty:10,forecastP90Qty:80,capacityQty:46,packQty:12,minTransferQty:12,unitMargin:50000}
  ],{routes:[{fromLocationId:'DC',toLocationId:'STORE',fixedCost:10000,variableCostPerUnit:1000}],minNetValue:0});
  assert.equal(recommendation.recommendedQty,36);
  assert.equal(recommendation.destinationShortageQty,36);
  assert.equal(recommendation.expectedLogisticsCost,46000);
});

test('optimizer reduces a recommendation to the quantity affordable within budget',()=>{
  const [recommendation]=optimizeRebalancing([
    {skuId:'S1',locationId:'A',availableQty:200,forecastP90Qty:50,packQty:10,unitMargin:100},
    {skuId:'S1',locationId:'B',availableQty:0,forecastP90Qty:100,packQty:10,unitMargin:100}
  ],{routes:[{fromLocationId:'A',toLocationId:'B',fixedCost:10,variableCostPerUnit:2}],budgetAmount:55});
  assert.equal(recommendation.recommendedQty,20);
  assert.equal(recommendation.expectedLogisticsCost,50);
});

test('optimizer skips unknown routes and negative-value transfers',()=>{
  const positions=[
    {skuId:'S1',locationId:'A',availableQty:100,forecastP90Qty:20,packQty:5,unitMargin:1},
    {skuId:'S1',locationId:'B',availableQty:0,forecastP90Qty:40,packQty:5,unitMargin:1}
  ];
  assert.equal(optimizeRebalancing(positions,{routes:[{fromLocationId:'B',toLocationId:'A'}]}).length,0);
  assert.equal(optimizeRebalancing(positions,{routes:[{fromLocationId:'A',toLocationId:'B',fixedCost:100}],minNetValue:0}).length,0);
});

test('outcome measurement compares execution, forecast and realized economics',()=>{
  assert.deepEqual(measureRecommendationOutcome({recommendedQty:40,executedQty:30,expectedNetValue:1000,forecastQty:50,realizedSalesQty:45,realizedRevenueGain:3000,realizedMarginGain:1800,realizedLogisticsCost:500}),{
    recommendedQty:40,executedQty:30,realizedRevenueGain:3000,realizedMarginGain:1800,realizedLogisticsCost:500,realizedNetValue:1300,quantityErrorPct:25,forecastErrorPct:10,netValueVariance:300
  });
});
