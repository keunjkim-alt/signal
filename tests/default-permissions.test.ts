import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultPagePermissions,defaultPermissionPages,permissionPageKeys} from '../api/_lib/default-permissions.ts';
test('new accounts always receive action and sales overview',()=>{for(const role of ['viewer','member','manager']){const pages=defaultPermissionPages(role,'소속 미지정');assert.ok(pages.includes('action'));assert.ok(pages.includes('hub'))}});
test('team defaults expose relevant menus',()=>{assert.deepEqual(defaultPermissionPages('member','재고운영팀'),['action','hub','sales','production','inventory']);assert.ok(defaultPermissionPages('manager','마케팅팀').includes('marketing'))});
test('viewer stays read only and full access roles need no duplicated rows',()=>{assert.ok(defaultPagePermissions('viewer','판매팀').every(item=>item.can_view&&!item.can_update&&!item.can_approve));assert.deepEqual(defaultPermissionPages('admin','AX 운영팀'),[]);assert.ok(permissionPageKeys.includes('permissions'))});
