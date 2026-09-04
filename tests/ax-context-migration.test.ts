import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/0020_ax_conversation_context.sql',import.meta.url),'utf8');

test('conversation context migration scopes rows to organization workspace user and conversation',()=>{
  for(const field of ['organization_id','workspace_id','conversation_id','user_id','context_state','context_version'])assert.match(migration,new RegExp(field));
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/is_workspace_member\(workspace_id\)/i);
  assert.match(migration,/c\.user_id=auth\.uid\(\)/i);
  assert.match(migration,/unique \(conversation_id\)/i);
});
