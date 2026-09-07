import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const query=readFileSync(new URL('../api/dashboards/query.ts',import.meta.url),'utf8');

test('decision action refresh invalidates its aggregate cache before loading',()=>{
  const getHandler=query.slice(query.indexOf("if(resource==='decision-actions')"),query.indexOf("if(resource==='product-intelligence')"));
  assert.match(getHandler,/searchParams\.get\('refresh'\)==='1'/);
  assert.match(getHandler,/invalidateDashboardCache\(context\.membership\.organization_id,\['decision-actions'\]\)/);
  assert.ok(getHandler.indexOf('invalidateDashboardCache')<getHandler.indexOf('decisionActionContext'));
});
