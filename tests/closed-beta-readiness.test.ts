import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateClosedBetaReadiness,type ReadinessInput} from '../api/_lib/closed-beta-readiness.js';

const ready:ReadinessInput={activeMembers:3,ownerAdmins:1,scopedMembers:2,permissionRows:18,salesOrders:800,salesLines:1440,inventorySnapshots:56,completedSalesImports:1,completedInventoryImports:1,salesMappings:1,inventoryMappings:1,salesReconciliation:'matched',inventoryReconciliation:'matched',analyticsRuns:2,analyticsFailures:0,axConversations:2,auditEvents:15,approvedActions:2,productionOrders:1,reorderIntegrityIssues:0,sourceErrors:0,openaiConfigured:true};

test('closed beta reaches 100 only when the full operating path is ready',()=>{
  const result=evaluateClosedBetaReadiness(ready);
  assert.equal(result.score,100);
  assert.equal(result.ready,true);
  assert.equal(result.blockers.length,0);
});

test('data mismatch and missing execution remain launch blockers',()=>{
  const result=evaluateClosedBetaReadiness({...ready,inventoryReconciliation:'mismatch',productionOrders:0,reorderIntegrityIssues:1});
  assert.equal(result.ready,false);
  assert.equal(result.score,76);
  assert.deepEqual(result.blockers.map(item=>item.key),['reconciliation','execution']);
});

test('missing reusable mapping is visible without hiding core readiness failures',()=>{
  const result=evaluateClosedBetaReadiness({...ready,salesMappings:0});
  assert.equal(result.ready,false);
  assert.equal(result.score,92);
  assert.equal(result.warnings[0].key,'mapping');
  assert.match(result.warnings[0].nextAction||'',/회사 매핑/);
});
