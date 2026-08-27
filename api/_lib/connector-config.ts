const SOURCE_TYPES=['sheet','sftp','api'] as const;
const ENTITY_TYPES=['product_master','sales_order','inventory_snapshot'];

function invalid(message:string){throw Object.assign(new Error(message),{status:422})}
function clean(value:any,max=160){return String(value||'').trim().slice(0,max)}

export function normalizeConnectorDraft(body:any){
  const sourceType=clean(body?.source_type,30) as (typeof SOURCE_TYPES)[number],name=clean(body?.name,120),entityType=clean(body?.entity_type,60);
  if(!SOURCE_TYPES.includes(sourceType))invalid('지원하지 않는 연결 방식입니다.');
  if(!name)invalid('연결 이름을 입력해주세요.');
  if(!ENTITY_TYPES.includes(entityType))invalid('표준 데이터 유형을 선택해주세요.');
  const syncMode=clean(body?.sync_mode,30)||'scheduled',schedule=clean(body?.schedule,80)||null;
  let provider=clean(body?.provider,60),connection:any={};
  if(sourceType==='sheet'){
    provider='google_sheets';const spreadsheetUrl=clean(body?.spreadsheet_url,500),sheetRange=clean(body?.sheet_range,120)||'Sheet1!A:Z',accessMode=clean(body?.access_mode,30)||'published_read';
    if(!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/.test(spreadsheetUrl))invalid('올바른 Google Sheets URL을 입력해주세요.');
    connection={spreadsheet_url:spreadsheetUrl,sheet_range:sheetRange,access_mode:accessMode};
  }
  if(sourceType==='sftp'){
    provider=provider||'wms_sftp';const host=clean(body?.host,180),remotePath=clean(body?.remote_path,300),credentialRef=clean(body?.credential_ref,120),port=Math.max(1,Math.min(65535,Number(body?.port)||22));
    if(!host||!remotePath||!credentialRef)invalid('SFTP 호스트, 원격 경로, 서버 자격증명 참조값이 필요합니다.');
    connection={host,port,remote_path:remotePath,credential_ref:credentialRef};
  }
  if(sourceType==='api'){
    const allowedProviders=['naver','musinsa','29cm','wconcept','own_shop','custom_api'];provider=provider||'custom_api';if(!allowedProviders.includes(provider))invalid('지원하지 않는 채널 API입니다.');
    const accountLabel=clean(body?.account_label,120),merchantId=clean(body?.merchant_id,120),credentialRef=clean(body?.credential_ref,120);
    if(!accountLabel||!credentialRef)invalid('계정 표시명과 서버 자격증명 참조값이 필요합니다.');
    connection={account_label:accountLabel,merchant_id:merchantId||null,credential_ref:credentialRef};
  }
  return {name,source_type:sourceType,provider,entity_type:entityType,sync_mode:syncMode,schedule,config:{entity_type:entityType,connection,activation:{state:'registered_pending_sync',registered_at:new Date().toISOString()}}};
}

export function inspectConnectorDraft(body:any){
  const normalized=normalizeConnectorDraft(body),type=normalized.source_type,connection=normalized.config.connection,checks=[
    {key:'schema',label:'필수 설정',status:'passed',message:'등록에 필요한 항목이 모두 입력되었습니다.'},
    {key:'secret',label:'자격증명 보안',status:'passed',message:type==='sheet'?'브라우저에 비밀키를 저장하지 않습니다.':`${connection.credential_ref} 서버 참조값을 사용합니다.`},
    {key:'worker',label:'자동 동기화',status:'pending',message:'연결 등록 후 커넥터 워커와 자격증명을 활성화해야 합니다.'}
  ];
  if(type==='sheet'&&connection.access_mode==='published_read')checks[2]={key:'worker',label:'자동 동기화',status:'pending',message:'공개 읽기 URL 등록 후 Sheets 수집 워커를 활성화해야 합니다.'};
  return {valid:true,normalized,activation:'registered_pending_sync',checks};
}
