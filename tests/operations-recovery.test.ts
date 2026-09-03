import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAssignmentUpdate,sourceOperationsView,validateImportRetry} from '../api/_lib/operations-recovery.js';

test('failed and partial imports can reuse their original source and mapping',()=>{
  assert.deepEqual(validateImportRetry({id:'job-1',status:'failed',raw_upload_id:'upload-1',data_source_id:'source-1',entity_type:'sales_order',summary:{mapping:{sku_code:'품번'}}}),{jobId:'job-1',uploadId:'upload-1',sourceId:'source-1',entityType:'sales_order',mapping:{sku_code:'품번'}});
  assert.equal(validateImportRetry({id:'job-2',status:'partial',raw_upload_id:'upload-2',entity_type:'inventory_snapshot'}).entityType,'inventory_snapshot');
  assert.throws(()=>validateImportRetry({id:'job-3',status:'completed',raw_upload_id:'upload-3',entity_type:'sales_order'}),/실패 또는 일부 완료/);
});

test('source operations view never exposes connector configuration',()=>{
  const view=sourceOperationsView({id:'source-1',config:{connection:{credential_ref:'secret-ref'},operations:{assignee_membership_id:'member-1',assigned_at:'2026-09-03T00:00:00.000Z'}}});
  assert.equal(view.config,undefined);
  assert.equal(view.assigneeMembershipId,'member-1');
});

test('source assignment preserves connector config and adds an auditable owner',()=>{
  const result=sourceAssignmentUpdate({id:'source-1',config:{entity_type:'sales_order'}},{id:'member-1',user_id:'user-1',status:'active'},'admin-1','2026-09-03T01:00:00.000Z');
  assert.equal(result.config.entity_type,'sales_order');
  assert.deepEqual(result.config.operations,{assignee_membership_id:'member-1',assignee_user_id:'user-1',assigned_at:'2026-09-03T01:00:00.000Z',assigned_by:'admin-1'});
});
