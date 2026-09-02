import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarWindow} from '../api/dashboards/query.ts';

test('dashboard period includes complete calendar days ending on the latest source date',()=>{
  const window=calendarWindow(14,'2026-08-31T23:42:00.000Z');
  assert.equal(window.start.toISOString(),'2026-08-18T00:00:00.000Z');
  assert.equal(window.end.toISOString(),'2026-09-01T00:00:00.000Z');
});

test('dashboard period falls back to the current calendar day for invalid anchors',()=>{
  const window=calendarWindow(7,'invalid',new Date('2026-09-02T15:30:00.000Z'));
  assert.equal(window.start.toISOString(),'2026-08-27T00:00:00.000Z');
  assert.equal(window.end.toISOString(),'2026-09-03T00:00:00.000Z');
});
