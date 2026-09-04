import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultPagePermissions,defaultPermissionPages,permissionPageKeys} from '../api/_lib/default-permissions.ts';
test('new team accounts always receive action and sales overview menus',()=>{
  for(const role of ['viewer','member','manager']){
    const pages=defaultPermissionPages(role,'소속 미지정');
    assert.ok(pages.includes('action'));
    assert.ok(pages.includes('hub'));
  }
});

test('team defaults expose the relevant execution pages',()=>{
  assert.deepEqual(defaultPermissionPages('member','재고운영팀'),['action','hub','sales','production','inventory']);
  assert.deepEqual(defaultPermissionPages('member','상품기획팀'),['action','hub','sales','planning','design','market','designer']);
  assert.ok(defaultPermissionPages('manager','마케팅팀').includes('marketing'));
});

test('viewer is read only and manager can approve defaults',()=>{
  assert.ok(defaultPagePermissions('viewer','판매팀').every(item=>item.can_view&&!item.can_update&&!item.can_approve));
  assert.ok(defaultPagePermissions('manager','생산팀').every(item=>item.can_view&&item.can_update&&item.can_approve));
});

test('full access roles rely on role access instead of duplicated page rows',()=>{
  assert.deepEqual(defaultPermissionPages('owner','경영진'),[]);
  assert.deepEqual(defaultPermissionPages('admin','AX 운영팀'),[]);
  assert.ok(permissionPageKeys.includes('permissions'));
  assert.ok(permissionPageKeys.includes('execution'));
});
