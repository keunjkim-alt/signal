import ExcelJS from 'exceljs';

function cellValue(cell:ExcelJS.Cell){
  const raw:any=cell.value;
  if(raw===null||raw===undefined)return null;
  if(raw instanceof Date)return raw;
  if(typeof raw==='object'){
    if('result' in raw)return raw.result??cell.text;
    if('text' in raw)return raw.text;
    if('richText' in raw)return raw.richText.map((part:any)=>part.text).join('');
  }
  return raw;
}

export async function readFirstWorksheetRows(buffer:ArrayBuffer,defval:any=null){
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet=workbook.worksheets[0];
  if(!sheet)return [];
  const headerRow=sheet.getRow(1),headers:string[]=[];
  for(let column=1;column<=headerRow.cellCount;column++)headers.push(String(cellValue(headerRow.getCell(column))??'').trim());
  const rows:Record<string,any>[]=[];
  for(let rowNumber=2;rowNumber<=sheet.rowCount;rowNumber++){
    const row=sheet.getRow(rowNumber),record:Record<string,any>={};let populated=false;
    headers.forEach((header,index)=>{if(!header)return;const value=cellValue(row.getCell(index+1));record[header]=value??defval;if(value!==null&&value!==undefined&&value!=='')populated=true});
    if(populated)rows.push(record);
  }
  return rows;
}
