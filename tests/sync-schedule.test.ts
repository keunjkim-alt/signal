import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleMinutes,sourceSyncDue} from '../api/_lib/sync-schedule.ts';

test('Korean schedule labels are converted to minutes',()=>{assert.equal(scheduleMinutes('15분'),15);assert.equal(scheduleMinutes('1시간'),60);assert.equal(scheduleMinutes('매일 06:00'),1440)});
test('scheduled source runs only after its interval',()=>{const now=new Date('2026-08-27T12:00:00Z');assert.equal(sourceSyncDue({sync_mode:'scheduled',status:'active',schedule:'15분',last_synced_at:'2026-08-27T11:44:59Z'},now),true);assert.equal(sourceSyncDue({sync_mode:'scheduled',status:'active',schedule:'15분',last_synced_at:'2026-08-27T11:50:00Z'},now),false);assert.equal(sourceSyncDue({sync_mode:'scheduled',status:'paused',schedule:'15분'},now),false)});
test('daily schedule follows the configured Korea time',()=>{assert.equal(sourceSyncDue({sync_mode:'scheduled',status:'active',schedule:'매일 06:00',last_synced_at:'2026-08-26T21:01:00Z'},new Date('2026-08-27T21:05:00Z')),true);assert.equal(sourceSyncDue({sync_mode:'scheduled',status:'active',schedule:'매일 06:00',last_synced_at:'2026-08-27T21:01:00Z'},new Date('2026-08-27T21:05:00Z')),false)});
