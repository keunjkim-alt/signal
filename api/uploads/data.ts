import {errorResponse,json} from '../_lib/http.js';
import {audit,insert,requestContext,requirePagePermission,supabase,update} from '../_lib/supabase.js';
import {inferMapping,parseWorkbook,sha256,validateAndNormalize} from '../_lib/wms.js';
import {inferSalesMapping,validateAndNormalizeSales} from '../_lib/sales.js';
import {chooseMapping,headerSignature} from '../_lib/mapping-templates.js';
import {refreshPostImportAnalytics} from '../_lib/post-import.js';

const MAX_SIZE=20*1024*1024;
const SUPPORTED=['inventory_snapshot','sales_order'];

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  let sourceId:string|null=null;
  try{
    const context=await requestContext(request);requirePagePermission(context,'connections','update');const org=context.membership.organization_id;
    const form=await request.formData(),file=form.get('file');
    if(!(file instanceof File))return json({ok:false,error:'file is required'},400);
    if(file.size>MAX_SIZE)return json({ok:false,error:'파일은 최대 20MB까지 지원합니다.'},413);
    const mode=String(form.get('mode')||'preview'),entityType=String(form.get('entityType')||'sales_order');
    if(!SUPPORTED.includes(entityType))return json({ok:false,error:`지원하지 않는 데이터 유형입니다: ${entityType}`},400);
    let requestedMapping={};try{requestedMapping=JSON.parse(String(form.get('mapping')||'{}'))}catch{return json({ok:false,error:'mapping must be valid JSON'},400)}
    const requestedSourceId=String(form.get('sourceId')||''),rows=await parseWorkbook(file),headers=rows.length?Object.keys(rows[0]):[],signature=await headerSignature(headers),template=await findMappingTemplate(org,entityType,signature,requestedSourceId||null),inferred=entityType==='sales_order'?inferSalesMapping(headers):inferMapping(headers),choice=chooseMapping(entityType,headers,requestedMapping,template?.mapping,inferred),mapping=choice.mapping,validation=entityType==='sales_order'?validateAndNormalizeSales(rows,mapping):validateAndNormalize(rows,mapping);
    const preview={filename:file.name,byteSize:file.size,entityType,headers,headerSignature:signature,mapping,mappingSource:choice.source,mappingTemplate:template?{id:template.id,name:template.name,version:template.version,dataSourceId:template.data_source_id}:null,totalRows:rows.length,validRows:validation.validRows.length,errorRows:validation.errors.length,missingFields:validation.missingFields,sample:validation.validRows.slice(0,8),errors:validation.errors.slice(0,20),period:(validation as any).period||inferPeriod(validation.validRows,entityType)};
    if(mode==='preview')return json({ok:true,mode:'preview',preview});
    if(validation.missingFields.length)return json({ok:false,error:'필수 컬럼 매핑이 필요합니다.',preview},422);
    const fileBytes=await file.arrayBuffer(),checksum=await sha256(fileBytes);
    sourceId=await ensureDataSource(org,context.user.id,requestedSourceId,entityType);
    const duplicate=await findCompletedUpload(org,entityType,checksum);
    if(duplicate){
      const existingJob=await findImportJob(duplicate.id);
      await audit(context,'file_import.duplicate_skipped','raw_upload',duplicate.id,{entityType,filename:file.name,checksum});
      return json({ok:true,mode:'import',duplicate:true,job:existingJob||{id:null,status:'completed',totalRows:rows.length,successRows:rows.length,errorRows:0},preview,source:await sourceSummary(sourceId)},200);
    }
    const upload=await persistRawFile(file,fileBytes,checksum,org,context.user.id,sourceId,entityType);
    const job=(await insert('import_jobs',{organization_id:org,raw_upload_id:upload.id,data_source_id:sourceId,mapping_template_id:template?.id||null,created_by:context.user.id,entity_type:entityType,status:'processing',total_rows:rows.length,started_at:new Date().toISOString(),summary:{mapping,mappingSource:choice.source,mappingTemplateId:template?.id||null,period:preview.period}}))?.[0];
    const result=entityType==='sales_order'?await ingestSales(validation.validRows,org,sourceId,upload.id,job.id):await ingestInventory(validation.validRows,org,sourceId,upload.id);
    const allErrors=[...validation.errors.map((item:any)=>({organization_id:org,import_job_id:job.id,...item})),...result.errors.map((item:any)=>({organization_id:org,import_job_id:job.id,...item}))];
    for(const chunk of chunks(allErrors,500))await insert('import_errors',chunk);
    const status=allErrors.length?result.successRows?'partial':'failed':'completed',completedAt=new Date().toISOString(),baseSummary={mapping,mappingSource:choice.source,mappingTemplateId:template?.id||null,period:preview.period,...result.summary};
    await update('import_jobs',{id:`eq.${job.id}`},{status,success_rows:result.successRows,error_rows:allErrors.length,inserted_rows:result.insertedRows,updated_rows:result.updatedRows,unchanged_rows:0,completed_at:completedAt,summary:baseSummary});
    await update('raw_uploads',{id:`eq.${upload.id}`},{status:status==='failed'?'failed':'completed'});
    await update('data_sources',{id:`eq.${sourceId}`,organization_id:`eq.${org}`},{status:status==='failed'?'error':'active',data_mode:status==='failed'?'stale':'connected',last_synced_at:completedAt,...(status==='failed'?{last_sync_error:`${allErrors.length}개 행 적재 실패`}:{last_successful_sync_at:completedAt,last_sync_error:null}),updated_at:completedAt});
    let analytics:any={status:'skipped',completed:0,failed:0,total:0,refreshedAt:null,asOfDate:null,results:[]};
    try{
      if(status!=='failed'&&result.successRows>0)analytics=await refreshPostImportAnalytics(org,{periodEnd:preview.period?.end});
      await update('import_jobs',{id:`eq.${job.id}`},{summary:{...baseSummary,analytics}});
    }catch(error:any){analytics={status:'failed',completed:0,failed:2,total:2,refreshedAt:new Date().toISOString(),asOfDate:preview.period?.end?.slice?.(0,10)||null,results:[],error:String(error?.message||error||'자동 분석 갱신 실패')}}
    await audit(context,'file_import.completed','import_job',job.id,{entityType,status,totalRows:rows.length,successRows:result.successRows,errorRows:allErrors.length,sourceId,mappingSource:choice.source,mappingTemplateId:template?.id||null,analytics:{status:analytics.status,completed:analytics.completed,failed:analytics.failed,asOfDate:analytics.asOfDate}});
    return json({ok:true,mode:'import',duplicate:false,job:{id:job.id,status,totalRows:rows.length,successRows:result.successRows,errorRows:allErrors.length,insertedRows:result.insertedRows,updatedRows:result.updatedRows,analytics},preview,source:await sourceSummary(sourceId)},status==='failed'?422:201);
  }catch(error:any){
    if(sourceId){try{await update('data_sources',{id:`eq.${sourceId}`},{status:'error',data_mode:'stale',last_sync_error:String(error?.message||error),last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()})}catch{}}
    return errorResponse(error,error.status||500);
  }
}};

async function ingestInventory(validRows:any[],org:string,sourceId:string,uploadId:string){
  const skuCodes=[...new Set(validRows.map(row=>row.sku_code))],locationCodes=[...new Set(validRows.map(row=>row.location_code))];
  const skus=await fetchMaster('skus','sku_code',skuCodes,org),locations=await fetchMaster('locations','location_code',locationCodes,org),skuMap=new Map(skus.map((item:any)=>[item.sku_code,item.id])),locationMap=new Map(locations.map((item:any)=>[item.location_code,item.id])),errors:any[]=[],snapshots:any[]=[];
  for(const row of validRows){const skuId=skuMap.get(row.sku_code),locationId=locationMap.get(row.location_code);if(!skuId||!locationId){errors.push({row_number:row.row_number,field_name:!skuId?'sku_code':'location_code',error_code:'MASTER_NOT_FOUND',message:!skuId?`미등록 SKU: ${row.sku_code}`:`미등록 위치: ${row.location_code}`,raw_row:row.raw_row});continue}snapshots.push({organization_id:org,source_id:sourceId,sku_id:skuId,location_id:locationId,snapshot_at:row.snapshot_at,on_hand_qty:row.on_hand_qty,reserved_qty:row.reserved_qty,available_qty:row.available_qty,in_transit_qty:row.in_transit_qty,damaged_qty:row.damaged_qty,safety_stock_qty:row.safety_stock_qty,raw_upload_id:uploadId})}
  for(const chunk of chunks(snapshots,500))await insert('inventory_snapshots',chunk,{upsert:true,onConflict:'organization_id,sku_id,location_id,snapshot_at'});
  return {successRows:snapshots.length,insertedRows:snapshots.length,updatedRows:0,errors,summary:{missingSku:skuCodes.filter(code=>!skuMap.has(code)),missingLocation:locationCodes.filter(code=>!locationMap.has(code))}};
}

async function ingestSales(validRows:any[],org:string,sourceId:string,uploadId:string,jobId:string){
  const skuCodes=[...new Set(validRows.map(row=>row.sku_code))],locationRows=dedupe(validRows.filter(row=>row.location_code).map(row=>({location_code:row.location_code,location_name:row.location_name||row.location_code,country_code:row.country_code||'KR'})),'location_code');
  const productRows=dedupe(validRows.map(row=>({organization_id:org,product_code:row.sku_code,product_name:row.product_name||row.sku_code,category_l1:row.category||null,attributes:{created_from:'sales_file'}})),'product_code');
  for(const chunk of chunks(productRows,500))await insert('products',chunk,{upsert:true,onConflict:'organization_id,product_code'});
  const products=await fetchMaster('products','product_code',skuCodes,org),productMap=new Map(products.map((item:any)=>[item.product_code,item.id]));
  const skuRows=skuCodes.map(code=>({organization_id:org,product_id:productMap.get(code)||null,sku_code:code,external_codes:{created_from:'sales_file'}}));
  for(const chunk of chunks(skuRows,500))await insert('skus',chunk,{upsert:true,onConflict:'organization_id,sku_code'});
  for(const chunk of chunks(locationRows.map(row=>({organization_id:org,...row,location_type:'store',timezone:'Asia/Seoul',active:true})),500))await insert('locations',chunk,{upsert:true,onConflict:'organization_id,location_code'});
  const [skus,locations]=await Promise.all([fetchMaster('skus','sku_code',skuCodes,org),fetchMaster('locations','location_code',locationRows.map(row=>row.location_code),org)]),skuMap=new Map(skus.map((item:any)=>[item.sku_code,item.id])),locationMap=new Map(locations.map((item:any)=>[item.location_code,item.id]));
  const grouped=new Map<string,any[]>();for(const row of validRows){const group=grouped.get(row.source_order_id)||[];group.push(row);grouped.set(row.source_order_id,group)}
  const now=new Date().toISOString(),orders=[...grouped.entries()].map(([sourceOrderId,items])=>{const first=items[0];return {organization_id:org,source_id:sourceId,source_order_id:sourceOrderId,channel_code:first.channel_code,location_id:first.location_code?locationMap.get(first.location_code)||null:null,ordered_at:first.sold_at,status:'paid',country_code:first.country_code,currency_code:first.currency_code,gross_amount:sum(items,'net_sales'),discount_amount:0,paid_amount:sum(items,'net_sales'),raw_upload_id:uploadId,import_job_id:jobId,source_updated_at:first.source_updated_at,updated_at:now}});
  for(const chunk of chunks(orders,500))await insert('sales_orders',chunk,{upsert:true,onConflict:'organization_id,source_id,source_order_id'});
  const orderIds=[...grouped.keys()],persistedOrders=await fetchOrders(orderIds,org,sourceId),orderMap=new Map(persistedOrders.map((item:any)=>[item.source_order_id,item.id])),existingLines=await fetchSalesLines(persistedOrders.map((item:any)=>item.id),org),existingLineKeys=new Set(existingLines.map((item:any)=>`${item.order_id}:${item.source_line_id}`)),errors:any[]=[],lines:any[]=[];
  for(const row of validRows){const orderId=orderMap.get(row.source_order_id),skuId=skuMap.get(row.sku_code),productId=productMap.get(row.sku_code);if(!orderId||!skuId){errors.push({row_number:row.row_number,field_name:!orderId?'order_id':'sku_code',error_code:'MASTER_NOT_FOUND',message:!orderId?`주문 생성 실패: ${row.source_order_id}`:`SKU 생성 실패: ${row.sku_code}`,raw_row:row.raw_row});continue}lines.push({organization_id:org,order_id:orderId,source_line_id:row.source_line_id,sku_id:skuId,product_id:productId||null,quantity:row.quantity,returned_quantity:0,unit_list_price:row.quantity?row.net_sales/row.quantity:0,unit_sale_price:row.quantity?row.net_sales/row.quantity:0,net_sales:row.net_sales,unit_cost:row.unit_cost||0,channel_fee:row.channel_fee||0,marketing_cost:row.marketing_cost||0,shipping_cost:row.shipping_cost||0,return_cost:row.return_cost||0,raw_upload_id:uploadId,import_job_id:jobId,source_updated_at:row.source_updated_at,updated_at:now})}
  for(const chunk of chunks(lines,500))await insert('sales_order_lines',chunk,{upsert:true,onConflict:'organization_id,order_id,source_line_id'});
  const updatedRows=lines.filter(line=>existingLineKeys.has(`${line.order_id}:${line.source_line_id}`)).length,insertedRows=lines.length-updatedRows;
  return {successRows:lines.length,insertedRows,updatedRows,errors,summary:{orders:orders.length,productsAutoCreated:productRows.length,locationsAutoCreated:locationRows.length}};
}

async function ensureDataSource(org:string,userId:string,requestedId:string,entityType:string){
  if(requestedId){const query=new URLSearchParams({id:`eq.${requestedId}`,organization_id:`eq.${org}`,select:'id',limit:'1'}),rows=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[];if(rows[0])return rows[0].id;const error:any=new Error('선택한 데이터 소스를 찾을 수 없습니다.');error.status=404;throw error}
  const provider=`file_upload_${entityType}`,query=new URLSearchParams({organization_id:`eq.${org}`,provider:`eq.${provider}`,select:'id',limit:'1'}),existing=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[];
  if(existing[0])return existing[0].id;
  return (await insert('data_sources',{organization_id:org,source_type:'file',provider,name:entityType==='sales_order'?'판매 파일 업로드':'재고 파일 업로드',status:'active',data_mode:'connected',sync_mode:'manual',config:{entity_type:entityType},created_by:userId}))?.[0]?.id;
}

async function persistRawFile(file:File,fileBytes:ArrayBuffer,checksum:string,org:string,userId:string,sourceId:string,entityType:string){
  const uploadId=crypto.randomUUID(),safeName=file.name.replace(/[^a-zA-Z0-9가-힣._-]/g,'_'),storagePath=`${org}/${uploadId}/${safeName}`;
  await supabase(`/storage/v1/object/raw-imports/${encodeURI(storagePath)}`,{serviceRole:true,method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-upsert':'false'},body:fileBytes});
  return (await insert('raw_uploads',{id:uploadId,organization_id:org,data_source_id:sourceId,uploaded_by:userId,original_filename:file.name,storage_path:storagePath,content_type:file.type||null,byte_size:file.size,checksum,entity_type:entityType,status:'processing'}))?.[0];
}

async function findCompletedUpload(org:string,entityType:string,checksum:string){const query=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,checksum:`eq.${checksum}`,status:'eq.completed',select:'id,created_at,original_filename',order:'created_at.desc',limit:'1'});return ((await supabase(`/rest/v1/raw_uploads?${query}`,{serviceRole:true})).data||[])[0]||null}
async function findMappingTemplate(org:string,entityType:string,signature:string,requestedSourceId:string|null){
  if(requestedSourceId){const specific=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:`eq.${requestedSourceId}`,active:'eq.true',select:'id,name,version,mapping,data_source_id',order:'version.desc,created_at.desc',limit:'1'}),row=((await supabase(`/rest/v1/mapping_templates?${specific}`,{serviceRole:true})).data||[])[0];if(row)return row}
  const generic=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:'is.null',active:'eq.true',select:'id,name,version,mapping,data_source_id',order:'version.desc,created_at.desc',limit:'1'});
  return ((await supabase(`/rest/v1/mapping_templates?${generic}`,{serviceRole:true})).data||[])[0]||null;
}
async function findImportJob(uploadId:string){const query=new URLSearchParams({raw_upload_id:`eq.${uploadId}`,select:'id,status,total_rows,success_rows,error_rows,inserted_rows,updated_rows',order:'created_at.desc',limit:'1'}),row=((await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[])[0];return row?{id:row.id,status:row.status,totalRows:row.total_rows,successRows:row.success_rows,errorRows:row.error_rows,insertedRows:row.inserted_rows,updatedRows:row.updated_rows}:null}
async function sourceSummary(sourceId:string){const query=new URLSearchParams({id:`eq.${sourceId}`,select:'id,name,provider,status,data_mode,last_synced_at,last_successful_sync_at,last_sync_error',limit:'1'});return ((await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[])[0]||null}
async function fetchMaster(table:string,field:string,codes:string[],org:string){if(!codes.length)return [];const filter=`in.(${codes.map(code=>`"${String(code).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&${field}=${encodeURIComponent(filter)}&select=id,${field}&limit=50000`;return (await supabase(`/rest/v1/${table}?${query}`,{serviceRole:true})).data||[]}
async function fetchOrders(ids:string[],org:string,sourceId:string){if(!ids.length)return [];const filter=`in.(${ids.map(id=>`"${String(id).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&source_id=eq.${encodeURIComponent(sourceId)}&source_order_id=${encodeURIComponent(filter)}&select=id,source_order_id&limit=50000`;return (await supabase(`/rest/v1/sales_orders?${query}`,{serviceRole:true})).data||[]}
async function fetchSalesLines(orderIds:string[],org:string){if(!orderIds.length)return [];const filter=`in.(${orderIds.map(id=>`"${String(id).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&order_id=${encodeURIComponent(filter)}&select=order_id,source_line_id&limit=50000`;return (await supabase(`/rest/v1/sales_order_lines?${query}`,{serviceRole:true})).data||[]}
function chunks<T>(items:T[],size:number){const result:T[][]=[];for(let index=0;index<items.length;index+=size)result.push(items.slice(index,index+size));return result}
function dedupe<T extends Record<string,any>>(items:T[],key:string){return [...new Map(items.map(item=>[item[key],item])).values()]}
function sum(items:any[],key:string){return items.reduce((total,item)=>total+Number(item[key]||0),0)}
function inferPeriod(rows:any[],entityType:string){const field=entityType==='sales_order'?'sold_at':'snapshot_at',values=rows.map(row=>row[field]).filter(Boolean).sort();return {start:values[0]||null,end:values.at(-1)||null}}
