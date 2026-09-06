import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

test('permission save releases the loading guard before reloading users',async()=>{
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  assert.match(source,/state\.permissionUsers=null;state\.permissionRoleDraft=null;state\.permissionBusy=false;await loadPermissionUsers\(true\)/);
  assert.match(source,/finally\{state\.permissionBusy=false;refreshDashboardBody\(\{expectedPage:'permissions'\}\)\}/);
});
