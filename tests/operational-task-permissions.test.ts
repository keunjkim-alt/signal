import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('team task transition checks the task target page instead of granting broad execution access',()=>{
  const source=readFileSync(new URL('../api/_lib/handlers/decisions.ts',import.meta.url),'utf8');
  assert.match(source,/requirePagePermission\(context,String\(task\.metadata\?\.target_page\|\|'execution'\),'update'\)/);
  assert.doesNotMatch(source,/transitionTask[\s\S]{0,180}requirePagePermission\(context,'execution','update'\)/);
});
