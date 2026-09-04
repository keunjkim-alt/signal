const EXCEL_EPOCH_UTC=Date.UTC(1899,11,30);
const DAY_MS=86_400_000;

export function parseSpreadsheetDate(value:any,{assumeKst=false}:{assumeKst?:boolean}={}){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString();
  const text=String(value??'').trim();
  if(!text)return null;
  if(/^\d{4,5}(?:\.\d+)?$/.test(text)){
    const serial=Number(text);
    if(serial>=20_000&&serial<=80_000){
      // Excel serials do not carry a timezone. Keeping the encoded wall-clock
      // value in UTC preserves the business date and also supports workbooks
      // exported from ISO timestamps without shifting them to the prior day.
      const date=new Date(EXCEL_EPOCH_UTC+serial*DAY_MS);
      return Number.isNaN(date.getTime())?null:date.toISOString();
    }
  }
  let normalized=text.replace(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/,'$1-$2-$3');
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized))normalized=`${normalized}T00:00:00${assumeKst?'+09:00':'Z'}`;
  else if(assumeKst&&/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(normalized))normalized=`${normalized.replace(' ','T')}+09:00`;
  const date=new Date(normalized);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}
