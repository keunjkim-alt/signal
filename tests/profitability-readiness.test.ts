import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeProfitabilityReadiness} from '../api/dashboards/query.ts';

test('profitability readiness requires cost coverage on at least 80 percent of lines',()=>{
  const ready=summarizeProfitabilityReadiness([
    {unit_cost:50,channel_fee:5},{unit_cost:50,marketing_cost:4},{unit_cost:50,shipping_cost:3},{unit_cost:50,return_cost:2},{unit_cost:50}
  ]);
  assert.equal(ready.ready,true);
  assert.equal(ready.costCoveragePct,100);
  assert.equal(ready.variableCostCoveragePct,80);

  const incomplete=summarizeProfitabilityReadiness([{unit_cost:50},{unit_cost:0},{unit_cost:0}]);
  assert.equal(incomplete.ready,false);
  assert.equal(incomplete.costCoveragePct,33.3);
});
