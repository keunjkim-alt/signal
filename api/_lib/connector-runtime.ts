const MAX_PULL_BYTES=20*1024*1024;

function invalid(message:string,status=422):never{throw Object.assign(new Error(message),{status})}

export function parseGoogleSheetReference(spreadsheetUrl:string,sheetRange='Sheet1!A:Z'){
  let url:URL;try{url=new URL(String(spreadsheetUrl||''))}catch{invalid('Google Sheets URL을 확인해주세요.')}
  if(url.hostname!=='docs.google.com')invalid('Google Sheets 공식 URL만 연결할 수 있습니다.');
  const match=url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);if(!match)invalid('Google Sheets 문서 ID를 찾을 수 없습니다.');
  const [rawSheet,...rangeParts]=String(sheetRange||'Sheet1!A:Z').split('!'),sheet=(rawSheet||'Sheet1').replace(/^'|'$/g,''),range=rangeParts.join('!')||'A:Z';
  return {spreadsheetId:match[1],sheet,range};
}

export function googleSheetCsvUrl(connection:any){
  const ref=parseGoogleSheetReference(connection?.spreadsheet_url,connection?.sheet_range),params=new URLSearchParams({tqx:'out:csv',sheet:ref.sheet,range:ref.range});
  return `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/gviz/tq?${params}`;
}

export function credentialRegistry(raw=process.env.VIIMSIGNAL_CONNECTOR_CREDENTIALS||''){
  if(!raw)return {};
  try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed}catch{invalid('VIIMSIGNAL_CONNECTOR_CREDENTIALS 환경변수가 올바른 JSON이 아닙니다.',500)}
}

export async function pullConnectorFile(source:any,options:{fetchImpl?:typeof fetch;credentialsRaw?:string}={}){
  const fetchImpl=options.fetchImpl||fetch,type=String(source?.source_type||''),connection=source?.config?.connection||{},entityType=String(source?.config?.entity_type||'');
  if(!['product_master','sales_order','inventory_snapshot'].includes(entityType))invalid(`아직 자동 적재를 지원하지 않는 데이터 유형입니다: ${entityType||'미지정'}`);
  if(type==='sheet'){
    const response=await fetchImpl(googleSheetCsvUrl(connection),{headers:{accept:'text/csv'}});return responseToFile(response,`${safeName(source.name||'google-sheet')}.csv`);
  }
  const registry=credentialRegistry(options.credentialsRaw),reference=String(connection.credential_ref||''),credential=registry[reference];
  if(!reference||!credential)invalid(`서버 자격증명 '${reference||'미지정'}'을 찾을 수 없습니다. Vercel 환경변수를 확인해주세요.`,409);
  if(type==='sftp')return pullSftpRelay(source,credential,fetchImpl);
  if(type==='api')return pullChannelApi(source,credential,fetchImpl);
  invalid('이 연결 방식은 자동 동기화를 지원하지 않습니다.');
}

export async function probeConnector(source:any,options:{fetchImpl?:typeof fetch;credentialsRaw?:string}={}){
  const file=await pullConnectorFile(source,options),text=await file.text(),lines=text.split(/\r?\n/).filter(Boolean),headers=csvFirstRow(lines[0]||'');
  if(!headers.length)invalid('연결은 되었지만 읽을 수 있는 헤더가 없습니다.');
  return {reachable:true,filename:file.name,byteSize:file.size,headers:headers.slice(0,30),sampleRows:Math.max(0,lines.length-1),checkedAt:new Date().toISOString()};
}

async function pullSftpRelay(source:any,credential:any,fetchImpl:typeof fetch){
  if(credential.kind!=='sftp_relay'||!credential.endpoint)invalid('SFTP 연결은 서버의 sftp_relay 자격증명이 필요합니다.',409);
  assertHttps(credential.endpoint,'SFTP 게이트웨이');
  const connection=source.config.connection,response=await fetchImpl(credential.endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'text/csv, application/json',...(credential.token?{authorization:`Bearer ${credential.token}`}:{})},body:JSON.stringify({action:'pull_latest',host:connection.host,port:connection.port,remote_path:connection.remote_path,entity_type:source.config.entity_type})});
  return responseToFile(response,`${safeName(source.name||'wms')}.csv`,fetchImpl,credential);
}

async function pullChannelApi(source:any,credential:any,fetchImpl:typeof fetch){
  if(credential.kind!=='channel_api'||!credential.endpoint)invalid('채널 API 연결은 서버의 channel_api 자격증명이 필요합니다.',409);
  assertHttps(credential.endpoint,'채널 API');
  const endpoint=new URL(credential.endpoint);if(source.config.connection.merchant_id)endpoint.searchParams.set('merchant_id',source.config.connection.merchant_id);
  const headers:any={accept:'application/json, text/csv',...(credential.headers&&typeof credential.headers==='object'?credential.headers:{})};if(credential.token)headers.authorization=`Bearer ${credential.token}`;
  const response=await fetchImpl(endpoint.toString(),{method:credential.method||'GET',headers});return responseToFile(response,`${safeName(source.provider||source.name||'channel')}.csv`,fetchImpl,credential);
}

async function responseToFile(response:Response,filename:string,fetchImpl:typeof fetch=fetch,credential:any={}){
  if(!response.ok)invalid(`원천 연결 응답 오류 (${response.status})`,502);
  const contentType=response.headers.get('content-type')||'';
  if(contentType.includes('text/html'))invalid('원천이 데이터 대신 로그인/권한 화면을 반환했습니다. 공유 권한 또는 자격증명을 확인해주세요.',403);
  if(contentType.includes('application/json')){
    const payload=await response.json() as any;
    if(payload?.download_url){assertHttps(payload.download_url,'다운로드 URL');return responseToFile(await fetchImpl(payload.download_url,{headers:credential.download_headers||{}}),payload.filename||filename,fetchImpl,credential)}
    const rows=resolvePath(payload,credential.response_path||'items');if(!Array.isArray(rows))invalid('API 응답에서 행 배열을 찾을 수 없습니다. 자격증명의 response_path를 확인해주세요.',502);
    const csv=rowsToCsv(rows);return checkedFile(csv,payload?.filename||filename,'text/csv');
  }
  const bytes=await response.arrayBuffer();if(bytes.byteLength>MAX_PULL_BYTES)invalid('원천 파일이 20MB를 초과합니다.',413);return new File([bytes],filename,{type:contentType||'text/csv'});
}

function checkedFile(content:string,filename:string,type:string){const bytes=new TextEncoder().encode(content);if(bytes.byteLength>MAX_PULL_BYTES)invalid('원천 파일이 20MB를 초과합니다.',413);return new File([bytes],filename,{type})}
function resolvePath(payload:any,path:string){if(Array.isArray(payload))return payload;return String(path||'items').split('.').filter(Boolean).reduce((value,key)=>value?.[key],payload)}
function rowsToCsv(rows:any[]){if(!rows.length)return '';const normalized=rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)),headers=[...new Set(normalized.flatMap(row=>Object.keys(row)))];return [headers,...normalized.map(row=>headers.map(header=>serializeCell(row[header])))].map(row=>row.map(csvCell).join(',')).join('\n')}
function serializeCell(value:any){return value&&typeof value==='object'?JSON.stringify(value):String(value??'')}
function csvCell(value:any){const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text}
function csvFirstRow(line:string){return line?line.match(/("(?:[^"]|"")*"|[^,]+)/g)?.map(value=>value.replace(/^"|"$/g,'').replace(/""/g,'"').trim()).filter(Boolean)||[]:[]}
function safeName(value:string){return String(value).replace(/[^a-zA-Z0-9가-힣_-]/g,'_').slice(0,80)||'source'}
function assertHttps(value:string,label:string){let url:URL;try{url=new URL(value)}catch{invalid(`${label} 설정이 올바른 URL이 아닙니다.`,500)}if(url.protocol!=='https:')invalid(`${label}는 HTTPS 주소만 허용합니다.`,500)}
