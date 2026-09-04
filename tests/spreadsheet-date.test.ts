import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSpreadsheetDate} from '../api/_lib/spreadsheet-date.js';

test('Excel serial dates from XLSX uploads are converted into ISO timestamps',()=>{
  assert.equal(parseSpreadsheetDate('46162.0416666667',{assumeKst:true})?.slice(0,16),'2026-05-20T01:00');
  assert.equal(parseSpreadsheetDate(46265.5,{assumeKst:true})?.slice(0,10),'2026-08-31');
});

test('ISO and Korean business dates remain supported',()=>{
  assert.equal(parseSpreadsheetDate('2026-08-31T12:00:00.000Z',{assumeKst:true}),'2026-08-31T12:00:00.000Z');
  assert.equal(parseSpreadsheetDate('2026.08.31 09:00',{assumeKst:true})?.slice(0,16),'2026-08-31T00:00');
  assert.equal(parseSpreadsheetDate('not-a-date',{assumeKst:true}),null);
});
