import {readFirstWorksheetRows} from './excel.js';
import {parseSpreadsheetDate} from './spreadsheet-date.js';

export const WMS_FIELDS={
  sku_code:['sku_code','sku','품번','상품코드','단품코드','품목코드','바코드','barcode'],
  location_code:['location_code','warehouse_code','store_code','창고코드','매장코드','점코드','로케이션코드'],
  location_name:['location_name','warehouse_name','store_name','창고명','매장명','점명','로케이션명'],
  snapshot_at:['snapshot_at','stock_date','base_date','기준일시','기준일','재고일자','재고기준일'],
  on_hand_qty:['on_hand_qty','stock_qty','현재고','재고수량','실재고','보유재고'],
  reserved_qty:['reserved_qty','allocated_qty','예약재고','할당재고','주문예약'],
  available_qty:['available_qty','available_stock','가용재고','판매가능재고','판매가능'],
  in_transit_qty:['in_transit_qty','transfer_qty','이동중재고','입고예정','운송중'],
  damaged_qty:['damaged_qty','defect_qty','불량재고','파손재고'],
  safety_stock_qty:['safety_stock_qty','safety_qty','안전재고','적정재고']
};

const required=['sku_code','location_code','snapshot_at','available_qty'];
const normalize=(value:any)=>String(value??'').trim().toLowerCase().replace(/[\s._\-/()]+/g,'');

export async function parseWorkbook(file:File){
  const ext=file.name.toLowerCase().split('.').pop();const bytes=new Uint8Array(await file.arrayBuffer());
  if(ext==='csv'){const text=new TextDecoder(detectEncoding(bytes)).decode(bytes);return parseCsv(text)}
  if(ext==='xlsx')return readFirstWorksheetRows(bytes.buffer,null);
  throw new Error('CSV 또는 XLSX 파일만 지원합니다.');
}

function detectEncoding(bytes:Uint8Array){return bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'utf-8':'utf-8'}

export function parseCsv(text:string){
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const char=text[i],next=text[i+1];if(char==='"'&&quoted&&next==='"'){cell+='"';i++}else if(char==='"'){quoted=!quoted}else if(char===','&&!quoted){row.push(cell);cell=''}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')i++;row.push(cell);if(row.some(value=>value.trim()!==''))rows.push(row);row=[];cell=''}else cell+=char}
  if(cell||row.length){row.push(cell);rows.push(row)}if(!rows.length)return [];
  const headers=rows[0].map(value=>value.replace(/^\ufeff/,'').trim());return rows.slice(1).map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??null])));
}

export function inferMapping(headers:string[],requested:any={}){
  const byNormalized=new Map(headers.map(header=>[normalize(header),header]));const mapping:any={};
  for(const [canonical,aliases] of Object.entries(WMS_FIELDS)){
    const explicit=requested[canonical];if(explicit&&headers.includes(explicit)){mapping[canonical]=explicit;continue}
    const match=(aliases as string[]).map(normalize).find(alias=>byNormalized.has(alias));if(match)mapping[canonical]=byNormalized.get(match);
  }
  return mapping;
}

export function validateAndNormalize(rows:Record<string,any>[],mapping:any){
  const missing=required.filter(field=>!mapping[field]);if(missing.length)return {validRows:[],errors:[],missingFields:missing};
  const validRows:any[]=[],errors:any[]=[];
  rows.forEach((row,index)=>{const get=(field:string)=>row[mapping[field]],sku=cleanCode(get('sku_code')),location=cleanCode(get('location_code')),snapshot=parseDate(get('snapshot_at')),available=parseNumber(get('available_qty'));const rowErrors:string[]=[];if(!sku)rowErrors.push('sku_code');if(!location)rowErrors.push('location_code');if(!snapshot)rowErrors.push('snapshot_at');if(available===null)rowErrors.push('available_qty');if(rowErrors.length){errors.push({row_number:index+2,error_code:'INVALID_ROW',field_name:rowErrors.join(','),message:`필수값 오류: ${rowErrors.join(', ')}`,raw_row:row});return}validRows.push({row_number:index+2,sku_code:sku,location_code:location,location_name:String(get('location_name')||location).trim(),snapshot_at:snapshot,on_hand_qty:parseNumber(get('on_hand_qty'))??available,reserved_qty:parseNumber(get('reserved_qty'))??0,available_qty:available,in_transit_qty:parseNumber(get('in_transit_qty'))??0,damaged_qty:parseNumber(get('damaged_qty'))??0,safety_stock_qty:parseNumber(get('safety_stock_qty'))??0,raw_row:row})});
  return {validRows,errors,missingFields:[]};
}

function cleanCode(value:any){return String(value??'').trim().toUpperCase()||null}
function parseNumber(value:any){if(value===null||value===undefined||value==='')return null;const number=Number(String(value).replace(/,/g,''));return Number.isFinite(number)?number:null}
function parseDate(value:any){return parseSpreadsheetDate(value,{assumeKst:true})}

export async function sha256(bytes:ArrayBuffer){const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('')}
