import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ExcelJS from 'exceljs';
import {parseBulkRows} from '../api/permissions/bulk.ts';
import {inferMapping,parseCsv,parseWorkbook,validateAndNormalize} from '../api/_lib/wms.ts';

function uploadFile(name:string,content:ArrayBuffer|string){
  const bytes=typeof content==='string'?new TextEncoder().encode(content):new Uint8Array(content);
  return {
    name,
    text:async()=>new TextDecoder().decode(bytes),
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
  } as File;
}

test('Korean WMS CSV headers are mapped and normalized',()=>{
  const rows=parseCsv('품번,창고코드,재고기준일,현재고,가용재고\nARC-07-BLK-M,WH-SEOUL,2026-08-13,120,95\n');
  const mapping=inferMapping(Object.keys(rows[0]));
  const result=validateAndNormalize(rows,mapping);
  assert.deepEqual(result.missingFields,[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows[0].sku_code,'ARC-07-BLK-M');
  assert.equal(result.validRows[0].location_code,'WH-SEOUL');
  assert.equal(result.validRows[0].available_qty,95);
});

test('invalid inventory rows are isolated',()=>{
  const rows=parseCsv('sku_code,location_code,snapshot_at,available_qty\nARC-07,,not-a-date,abc\n');
  const result=validateAndNormalize(rows,inferMapping(Object.keys(rows[0])));
  assert.equal(result.validRows.length,0);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].field_name,/location_code/);
});

test('production-like WMS fixture maps all required fields',()=>{
  const fixture=fileURLToPath(new URL('./fixtures/wms_inventory_e2e.csv',import.meta.url));
  const rows=parseCsv(readFileSync(fixture,'utf8'));
  const result=validateAndNormalize(rows,inferMapping(Object.keys(rows[0])));
  assert.deepEqual(result.missingFields,[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows.length,3);
  assert.equal(result.validRows.reduce((sum,row)=>sum+row.available_qty,0),636);
});

test('XLSX inventory uploads use the first worksheet and preserve dates',async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('재고');
  sheet.addRow(['품번','창고코드','재고기준일','가용재고']);
  sheet.addRow(['ARC-07-BLK-M','WH-SEOUL',new Date('2026-08-21T00:00:00.000Z'),95]);
  const output=await workbook.xlsx.writeBuffer(),buffer=output instanceof ArrayBuffer?output:output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength);
  const rows=await parseWorkbook(uploadFile('inventory.xlsx',buffer as ArrayBuffer));
  const result=validateAndNormalize(rows,inferMapping(Object.keys(rows[0])));
  assert.deepEqual(result.missingFields,[]);
  assert.equal(result.errors.length,0);
  assert.equal(result.validRows[0].sku_code,'ARC-07-BLK-M');
  assert.equal(result.validRows[0].available_qty,95);
  assert.match(result.validRows[0].snapshot_at,/^2026-08-21T/);
});

test('bulk user registration parser accepts CSV and XLSX files',async()=>{
  const csvRows=await parseBulkRows(uploadFile('users.csv','이메일,이름,팀,역할\ntest@viceversa.ai,테스트,상품기획팀,팀 구성원\n'));
  assert.equal(csvRows[0]['이메일'],'test@viceversa.ai');

  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('사용자');
  sheet.addRow(['이메일','이름','팀','역할']);
  sheet.addRow(['manager@viceversa.ai','매니저','재고운영팀','팀 관리자']);
  const output=await workbook.xlsx.writeBuffer(),buffer=output instanceof ArrayBuffer?output:output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength);
  const xlsxRows=await parseBulkRows(uploadFile('users.xlsx',buffer as ArrayBuffer));
  assert.equal(xlsxRows[0]['이메일'],'manager@viceversa.ai');
  assert.equal(xlsxRows[0]['역할'],'팀 관리자');
});
