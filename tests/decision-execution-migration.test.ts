import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const sql=readFileSync(fileURLToPath(new URL('../supabase/migrations/0014_decision_execution_feedback.sql',import.meta.url)),'utf8');

test('decision execution migration preserves recommendation, decision, execution and outcome lineage',()=>{
  assert.match(sql,/alter table public\.recommendation_decisions/);
  assert.match(sql,/create table if not exists public\.execution_requests/);
  assert.match(sql,/decision_id bigint not null references public\.recommendation_decisions/);
  assert.match(sql,/create table if not exists public\.execution_events/);
  assert.match(sql,/execution_request_id uuid references public\.execution_requests/);
});

test('execution evidence controls learning eligibility',()=>{
  assert.match(sql,/verification_method text not null default 'unverified'/);
  assert.match(sql,/learning_eligible boolean not null default false/);
  assert.match(sql,/create table if not exists public\.policy_change_candidates/);
});
