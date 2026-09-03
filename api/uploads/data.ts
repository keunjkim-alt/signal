import {errorResponse,json} from '../_lib/http.js';
import {audit,insert,requestContext,requirePagePermission,supabase,update} from '../_lib/supabase.js';
import {inferMapping,parseWorkbook,sha256,validateAndNormalize} from '../_lib/wms.js';
import {inferSalesMapping,validateAndNormalizeSales} from '../_lib/sales.js';
import {inferProductMapping,validateAndNormalizeProducts} from '../_lib/product-master.js';
import {classifyReview,inferReviewMapping,validateAndNormalizeReviews} from '../_lib/reviews.js';
import {chooseMapping,detectEntityType,headerSignature} from '../_lib/mapping-templates.js';
import {refreshPostImportAnalytics} from '../_lib/post-import.js';
import {buildReconciliation,inventoryControlTotals,persistedControlTotals,salesControlTotals,shouldBlockAnalytics} from '../_lib/reconciliation.js';
import {connectorSystemContext} from '../_lib/connector-auth.js';
import {invalidateDashboardCache} from '../_lib/dashboard-cache.js';

const MAX_SIZE=20*1024*1024;
const SUPPORTED=['product_master','inventory_snapshot','sales_order','product_review'];

export default {async fetch(request:Request){
  if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
  let sourceId:string|null=null,rawUploadId:string|null=null,importJobId:string|null=null,importSummary:any=null;
  try{
    const form=await request.formData(),file=form.get('file');
    if(!(file instanceof File))return json({ok:false,error:'file is required'},400);
    if(file.size>MAX_SIZE)return json({ok:false,error:'파일은 최대 20MB까지 지원합니다.'},413);
    const mode=String(form.get('mode')||'preview'),requestedEntityType=String(form.get('entityType')||'auto'),requestedSourceId=String(form.get('sourceId')||''),context=await connectorSystemContext(request,requestedSourceId)||await requestContext(request);requirePagePermission(context,'connections','update');const org=context.membership.organization_id;
    if(![...SUPPORTED,'auto'].includes(requestedEntityType))return json({ok:false,error:`지원하지 않는 데이터 유형입니다: ${requestedEntityType}`},400);
    if(mode!=='preview'&&requestedEntityType==='auto')return json({ok:false,error:'파일 미리보기에서 추천 데이터 유형을 확인한 뒤 적재해주세요.'},422);
    let requestedMapping={};try{requestedMapping=JSON.parse(String(form.get('mapping')||'{}'))}catch{return json({ok:false,error:'mapping must be valid JSON'},400)}
    const rows=await parseWorkbook(file),headers=rows.length?Object.keys(rows[0]):[],signature=await headerSignature(headers);
    const autoCandidates=SUPPORTED.map(type=>{const inferred=inferEntityMapping(type,headers),validation=validateEntityRows(type,rows,inferred);return [type,{mapping:inferred,validRows:validation.validRows.length,errorRows:validation.errors.length,missingFields:validation.missingFields}] as const}),detection=detectEntityType(Object.fromEntries(autoCandidates)),entityType=requestedEntityType==='auto'?detection.recommended:requestedEntityType;
    let template=await findMappingTemplate(org,entityType,signature,requestedSourceId||null);const inferred=inferEntityMapping(entityType,headers),choice=chooseMapping(entityType,headers,requestedMapping,template?.mapping,inferred),mapping=choice.mapping,validation=validateEntityRows(entityType,rows,mapping);let mappingSource=choice.source;
    const preview={filename:file.name,byteSize:file.size,requestedEntityType,entityType,detection:requestedEntityType==='auto'?detection:null,headers,headerSignature:signature,mapping,mappingSource,mappingTemplate:template?{id:template.id,name:template.name,version:template.version,dataSourceId:template.data_source_id}:null,totalRows:rows.length,validRows:validation.validRows.length,errorRows:validation.errors.length,missingFields:validation.missingFields,sample:validation.validRows.slice(0,8),errors:validation.errors.slice(0,20),period:(validation as any).period||inferPeriod(validation.validRows,entityType)};
    if(mode==='preview')return json({ok:true,mode:'preview',preview});
    if(validation.missingFields.length)return json({ok:false,error:'필수 컬럼 매핑이 필요합니다.',preview},422);
    const fileBytes=await file.arrayBuffer(),checksum=await sha256(fileBytes);
    sourceId=await ensureDataSource(org,context.user.id,requestedSourceId,entityType);
    if(!template){
      const saved=await ensureConfirmedMappingTemplate(org,context.user.id,entityType,signature,mapping,file.name);
      template=saved.template;
      preview.mappingTemplate=template?{id:template.id,name:template.name,version:template.version,dataSourceId:template.data_source_id}:null;
      if(saved.created){
        mappingSource='saved_template';preview.mappingSource=mappingSource;
        await audit(context,'mapping_template.auto_saved','mapping_template',template.id,{entityType,filename:file.name,headerSignature:signature,fieldCount:Object.keys(mapping||{}).length});
      }
    }
    const duplicate=await findCompletedUpload(org,entityType,checksum);
    if(duplicate){
      const existingJob=await findImportJob(duplicate.id);
      await audit(context,'file_import.duplicate_skipped','raw_upload',duplicate.id,{entityType,filename:file.name,checksum});
      return json({ok:true,mode:'import',duplicate:true,job:existingJob||{id:null,status:'completed',totalRows:rows.length,successRows:rows.length,errorRows:0},preview,source:await sourceSummary(sourceId)},200);
    }
    const upload=await persistRawFile(file,fileBytes,checksum,org,context.user.id,sourceId,entityType);
    rawUploadId=upload.id;
    importSummary={mapping,mappingSource,mappingTemplateId:template?.id||null,period:preview.period};
    const job=(await insert('import_jobs',{organization_id:org,raw_upload_id:upload.id,data_source_id:sourceId,mapping_template_id:template?.id||null,created_by:context.user.id,entity_type:entityType,status:'processing',total_rows:rows.length,started_at:new Date().toISOString(),summary:importSummary}))?.[0];
    importJobId=job.id;
    const sourceControl=entityType==='sales_order'?salesControlTotals(validation.validRows):entityType==='inventory_snapshot'?inventoryControlTotals(validation.validRows):{rows:validation.validRows.length,products:new Set(validation.validRows.map((row:any)=>row.product_code)).size,skus:new Set(validation.validRows.map((row:any)=>row.sku_code)).size},result=entityType==='sales_order'?await ingestSales(validation.validRows,org,sourceId,upload.id,job.id):entityType==='inventory_snapshot'?await ingestInventory(validation.validRows,org,sourceId,upload.id):entityType==='product_review'?await ingestReviews(validation.validRows,org,sourceId,upload.id,job.id):await ingestProductMaster(validation.validRows,org);
    const allErrors=[...validation.errors.map((item:any)=>({organization_id:org,import_job_id:job.id,...item})),...result.errors.map((item:any)=>({organization_id:org,import_job_id:job.id,...item}))];
    for(const chunk of chunks(allErrors,500))await insert('import_errors',chunk);
    const directlyCounted=['product_master','product_review'].includes(entityType),completedAt=new Date().toISOString(),persistedControl=directlyCounted?result.summary.persistedControl:await persistedControlTotals(org,{id:job.id,raw_upload_id:upload.id,entity_type:entityType}),reconciliation=directlyCounted?{entityType,status:'matched',matched:true,checkedAt:completedAt,filename:file.name,jobId:job.id,source:sourceControl,persisted:persistedControl,checks:[{key:'rows',label:'정상 행',unit:'행',source:result.successRows,persisted:result.successRows,difference:0,match:true}]}:buildReconciliation(entityType,sourceControl,persistedControl,{checkedAt:completedAt,filename:file.name,jobId:job.id});
    let status=allErrors.length?result.successRows?'partial':'failed':'completed';if(reconciliation.status==='mismatch'&&status!=='failed')status='partial';
    const baseSummary={mapping,mappingSource,mappingTemplateId:template?.id||null,period:preview.period,...result.summary,sourceControl,persistedControl,reconciliation};importSummary=baseSummary;
    await update('import_jobs',{id:`eq.${job.id}`},{status,success_rows:result.successRows,error_rows:allErrors.length,inserted_rows:result.insertedRows,updated_rows:result.updatedRows,unchanged_rows:0,completed_at:completedAt,summary:baseSummary});
    await update('raw_uploads',{id:`eq.${upload.id}`},{status:status==='failed'?'failed':'completed'});
    const qualityBlocked=shouldBlockAnalytics(reconciliation),syncError=qualityBlocked?'원천 파일과 운영 DB 합계가 일치하지 않아 분석 갱신을 차단했습니다.':status==='failed'?`${allErrors.length}개 행 적재 실패`:null;
    await update('data_sources',{id:`eq.${sourceId}`,organization_id:`eq.${org}`},{status:qualityBlocked||status==='failed'?'error':'active',data_mode:qualityBlocked||status==='failed'?'stale':'connected',last_synced_at:completedAt,...(qualityBlocked||status==='failed'?{last_sync_error:syncError}:{last_successful_sync_at:completedAt,last_sync_error:null}),updated_at:completedAt});
    let analytics:any={status:'skipped',completed:0,failed:0,total:0,refreshedAt:null,asOfDate:null,results:[]};
    try{
      if(qualityBlocked)analytics={status:'blocked',completed:0,failed:0,total:2,refreshedAt:completedAt,asOfDate:preview.period?.end?.slice?.(0,10)||null,results:[],reason:'DATA_RECONCILIATION_MISMATCH'};
      else if(['product_master','product_review'].includes(entityType))analytics={status:'skipped',completed:0,failed:0,total:0,refreshedAt:completedAt,asOfDate:preview.period?.end?.slice?.(0,10)||null,results:[],reason:entityType==='product_review'?'REVIEW_SIGNALS_PRECOMPUTED':'MASTER_DATA_REFRESH_ONLY'};
      else if(status!=='failed'&&result.successRows>0)analytics=await refreshPostImportAnalytics(org,{periodEnd:preview.period?.end});
      await update('import_jobs',{id:`eq.${job.id}`},{summary:{...baseSummary,analytics}});
    }catch(error:any){analytics={status:'failed',completed:0,failed:2,total:2,refreshedAt:new Date().toISOString(),asOfDate:preview.period?.end?.slice?.(0,10)||null,results:[],error:String(error?.message||error||'자동 분석 갱신 실패')}}
    if(qualityBlocked)await audit(context,'data_quality.reconciliation_blocked','import_job',job.id,{entityType,filename:file.name,sourceId,checks:reconciliation.checks.filter((check:any)=>!check.match)});
    await audit(context,'file_import.completed','import_job',job.id,{entityType,status,totalRows:rows.length,successRows:result.successRows,errorRows:allErrors.length,sourceId,mappingSource,mappingTemplateId:template?.id||null,reconciliation:reconciliation.status,analytics:{status:analytics.status,completed:analytics.completed,failed:analytics.failed,asOfDate:analytics.asOfDate}});
    invalidateDashboardCache(org);return json({ok:true,mode:'import',duplicate:false,job:{id:job.id,status,totalRows:rows.length,successRows:result.successRows,errorRows:allErrors.length,insertedRows:result.insertedRows,updatedRows:result.updatedRows,reconciliation,analytics},preview,source:await sourceSummary(sourceId)},status==='failed'?422:201);
  }catch(error:any){
    const failedAt=new Date().toISOString();
    if(importJobId){try{await update('import_jobs',{id:`eq.${importJobId}`},{status:'failed',completed_at:failedAt,summary:{...(importSummary||{}),failure:{message:String(error?.message||error||'적재 처리 실패').slice(0,500),failed_at:failedAt}}})}catch{}}
    if(rawUploadId){try{await update('raw_uploads',{id:`eq.${rawUploadId}`},{status:'failed'})}catch{}}
    if(sourceId){try{await update('data_sources',{id:`eq.${sourceId}`},{status:'error',data_mode:'stale',last_sync_error:String(error?.message||error),last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()})}catch{}}
    console.error('[file_import.failed]',{importJobId,rawUploadId,sourceId,error:String(error?.message||error)});
    return errorResponse(error,error.status||500);
  }
}};

async function ingestInventory(validRows:any[],org:string,sourceId:string,uploadId:string){
  const skuCodes=[...new Set(validRows.map(row=>row.sku_code))],locationCodes=[...new Set(validRows.map(row=>row.location_code))];
  const skus=await fetchMaster('skus','sku_code',skuCodes,org),locations=await fetchMaster('locations','location_code',locationCodes,org),skuMap=new Map(skus.map((item:any)=>[item.sku_code,item.id])),locationMap=new Map(locations.map((item:any)=>[item.location_code,item.id])),errors:any[]=[],snapshots:any[]=[];
  for(const row of validRows){const skuId=skuMap.get(row.sku_code),locationId=locationMap.get(row.location_code);if(!skuId||!locationId){errors.push({row_number:row.row_number,field_name:!skuId?'sku_code':'location_code',error_code:'MASTER_NOT_FOUND',message:!skuId?`미등록 SKU: ${row.sku_code}`:`미등록 위치: ${row.location_code}`,raw_row:row.raw_row});continue}snapshots.push({organization_id:org,source_id:sourceId,sku_id:skuId,location_id:locationId,snapshot_at:row.snapshot_at,on_hand_qty:row.on_hand_qty,reserved_qty:row.reserved_qty,available_qty:row.available_qty,in_transit_qty:row.in_transit_qty,damaged_qty:row.damaged_qty,safety_stock_qty:row.safety_stock_qty,raw_upload_id:uploadId})}
  for(const chunk of chunks(snapshots,500))await insert('inventory_snapshots',chunk,{upsert:true,onConflict:'organization_id,sku_id,location_id,snapshot_at'});
  return {successRows:snapshots.length,insertedRows:snapshots.length,updatedRows:0,errors,summary:{missingSku:skuCodes.filter(code=>!skuMap.has(code)),missingLocation:locationCodes.filter(code=>!locationMap.has(code)),persistedControl:inventoryControlTotals(snapshots)}};
}

async function ingestReviews(validRows:any[],org:string,sourceId:string,uploadId:string,jobId:string){
  const productCodes=[...new Set(validRows.map(row=>row.product_code))],skuCodes=[...new Set(validRows.map(row=>row.sku_code).filter(Boolean))],[products,skus]=await Promise.all([fetchMaster('products','product_code',productCodes,org),fetchMaster('skus','sku_code',skuCodes,org)]),productMap=new Map(products.map((row:any)=>[row.product_code,row.id])),skuMap=new Map(skus.map((row:any)=>[row.sku_code,row.id])),errors:any[]=[],reviewRows:any[]=[];
  for(const row of validRows){const productId=productMap.get(row.product_code);if(!productId){errors.push({row_number:row.row_number,field_name:'product_code',error_code:'MASTER_NOT_FOUND',message:`미등록 상품: ${row.product_code}`,raw_row:row.raw_row});continue}reviewRows.push({organization_id:org,data_source_id:sourceId,raw_upload_id:uploadId,import_job_id:jobId,product_id:productId,sku_id:skuMap.get(row.sku_code)||null,source_review_id:row.source_review_id,reviewed_at:row.reviewed_at,platform:row.platform,channel_code:row.channel_code,product_code:row.product_code,sku_code:row.sku_code,rating:row.rating,review_text:row.review_text,verified_purchase:row.verified_purchase,helpful_count:row.helpful_count,image_review:row.image_review,customer_token:row.customer_token,order_id:row.order_id,country_code:row.country_code,color:row.color,size:row.size,seller_response_status:row.seller_response_status,updated_at:new Date().toISOString()})}
  for(const chunk of chunks(reviewRows,400))await insert('product_reviews',chunk,{upsert:true,onConflict:'organization_id,platform,source_review_id'});
  const reviewIds:any[]=[];for(const group of chunks(reviewRows,100)){const ids=group.map(row=>row.source_review_id),filter=`in.(${ids.map(id=>`"${String(id).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&source_review_id=${encodeURIComponent(filter)}&select=id,source_review_id,platform&limit=50000`;reviewIds.push(...((await supabase(`/rest/v1/product_reviews?${query}`,{serviceRole:true})).data||[]))}
  const importedReviewIds=reviewIds.map(row=>row.id);for(const group of chunks(importedReviewIds,200)){const filter=`in.(${group.join(',')})`;await supabase(`/rest/v1/review_aspect_signals?organization_id=eq.${encodeURIComponent(org)}&review_id=${encodeURIComponent(filter)}`,{serviceRole:true,method:'DELETE'})}
  const idMap=new Map(reviewIds.map(row=>[`${row.platform}:${row.source_review_id}`,row.id])),signals:any[]=[];for(const row of validRows){const reviewId=idMap.get(`${row.platform}:${row.source_review_id}`);if(!reviewId)continue;for(const signal of classifyReview(row))signals.push({organization_id:org,review_id:reviewId,...signal})}
  for(const chunk of chunks(signals,500))await insert('review_aspect_signals',chunk,{upsert:true,onConflict:'review_id,aspect_code'});
  return {successRows:reviewRows.length,insertedRows:reviewRows.length,updatedRows:0,errors,summary:{reviews:reviewRows.length,aspectSignals:signals.length,products:new Set(reviewRows.map(row=>row.product_code)).size,persistedControl:{rows:reviewRows.length,products:new Set(reviewRows.map(row=>row.product_code)).size}}};
}

async function ingestProductMaster(validRows:any[],org:string){
  const productRows=dedupe(validRows.map(row=>({organization_id:org,product_code:row.product_code,product_name:row.product_name,category_l1:row.category_l1||null,category_l2:row.category_l2||null,season:row.season||null,image_url:row.image_url||null,attributes:{list_price:row.list_price,unit_cost:row.unit_cost,created_from:'product_master'}})),'product_code');
  const existingProducts=await fetchMaster('products','product_code',productRows.map(row=>row.product_code),org),existingProductCodes=new Set(existingProducts.map((row:any)=>row.product_code));
  for(const chunk of chunks(productRows,500))await insert('products',chunk,{upsert:true,onConflict:'organization_id,product_code'});
  const products=await fetchMaster('products','product_code',productRows.map(row=>row.product_code),org),productMap=new Map(products.map((item:any)=>[item.product_code,item.id]));
  const skuRows=dedupe(validRows.map(row=>({organization_id:org,product_id:productMap.get(row.product_code)||null,sku_code:row.sku_code,barcode:row.barcode||null,color:row.color||null,size:row.size||null,external_codes:{created_from:'product_master'}})),'sku_code'),existingSkus=await fetchMaster('skus','sku_code',skuRows.map(row=>row.sku_code),org),existingSkuCodes=new Set(existingSkus.map((row:any)=>row.sku_code));
  for(const chunk of chunks(skuRows,500))await insert('skus',chunk,{upsert:true,onConflict:'organization_id,sku_code'});
  const insertedProducts=productRows.filter(row=>!existingProductCodes.has(row.product_code)).length,insertedSkus=skuRows.filter(row=>!existingSkuCodes.has(row.sku_code)).length;
  return {successRows:validRows.length,insertedRows:insertedProducts+insertedSkus,updatedRows:(productRows.length-insertedProducts)+(skuRows.length-insertedSkus),errors:[],summary:{products:productRows.length,skus:skuRows.length,persistedControl:{rows:validRows.length,products:productRows.length,skus:skuRows.length}}};
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
  const now=new Date().toISOString(),orders=[...grouped.entries()].map(([sourceOrderId,items])=>{const first=items[0],paidAmount=sum(items,'net_sales');return {organization_id:org,source_id:sourceId,source_order_id:sourceOrderId,channel_code:first.channel_code,location_id:first.location_code?locationMap.get(first.location_code)||null:null,ordered_at:first.sold_at,status:first.order_status||'paid',country_code:first.country_code,currency_code:first.currency_code,gross_amount:paidAmount,discount_amount:0,paid_amount:paidAmount,customer_token:first.customer_token||null,shipping_region_1:first.shipping_region_1||null,shipping_region_2:first.shipping_region_2||null,raw_upload_id:uploadId,import_job_id:jobId,source_updated_at:first.source_updated_at,updated_at:now}});
  for(const chunk of chunks(orders,500))await insert('sales_orders',chunk,{upsert:true,onConflict:'organization_id,source_id,source_order_id'});
  const orderIds=[...grouped.keys()],persistedOrders=await fetchOrders(orderIds,org,sourceId),orderMap=new Map(persistedOrders.map((item:any)=>[item.source_order_id,item.id])),existingLines=await fetchSalesLines(persistedOrders.map((item:any)=>item.id),org),existingLineKeys=new Set(existingLines.map((item:any)=>`${item.order_id}:${item.source_line_id}`)),errors:any[]=[],lines:any[]=[];
  for(const row of validRows){const orderId=orderMap.get(row.source_order_id),skuId=skuMap.get(row.sku_code),productId=productMap.get(row.sku_code);if(!orderId||!skuId){errors.push({row_number:row.row_number,field_name:!orderId?'order_id':'sku_code',error_code:'MASTER_NOT_FOUND',message:!orderId?`주문 생성 실패: ${row.source_order_id}`:`SKU 생성 실패: ${row.sku_code}`,raw_row:row.raw_row});continue}lines.push({organization_id:org,order_id:orderId,source_line_id:row.source_line_id,sku_id:skuId,product_id:productId||null,quantity:row.quantity,returned_quantity:row.returned_quantity||0,unit_list_price:row.quantity?row.net_sales/row.quantity:0,unit_sale_price:row.quantity?row.net_sales/row.quantity:0,net_sales:row.net_sales,unit_cost:row.unit_cost||0,channel_fee:row.channel_fee||0,marketing_cost:row.marketing_cost||0,shipping_cost:row.shipping_cost||0,return_cost:row.return_cost||0,raw_upload_id:uploadId,import_job_id:jobId,source_updated_at:row.source_updated_at,updated_at:now})}
  for(const chunk of chunks(lines,500))await insert('sales_order_lines',chunk,{upsert:true,onConflict:'organization_id,order_id,source_line_id'});
  const updatedRows=lines.filter(line=>existingLineKeys.has(`${line.order_id}:${line.source_line_id}`)).length,insertedRows=lines.length-updatedRows;
  return {successRows:lines.length,insertedRows,updatedRows,errors,summary:{orders:orders.length,productsAutoCreated:productRows.length,locationsAutoCreated:locationRows.length,persistedControl:salesControlTotals(lines)}};
}

async function ensureDataSource(org:string,userId:string,requestedId:string,entityType:string){
  if(requestedId){const query=new URLSearchParams({id:`eq.${requestedId}`,organization_id:`eq.${org}`,select:'id,source_type,status,config',limit:'1'}),rows=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[],source=rows[0];if(!source){const error:any=new Error('선택한 데이터 소스를 찾을 수 없습니다.');error.status=404;throw error}if(source.status==='paused'||source.config?.lifecycle?.archived_at){const error:any=new Error('중지·보관된 소스에는 데이터를 적재할 수 없습니다.');error.status=409;throw error}if(source.config?.entity_type&&source.config.entity_type!==entityType){const error:any=new Error('선택한 소스의 데이터 유형과 파일 유형이 다릅니다.');error.status=422;throw error}return source.id}
  const provider=`file_upload_${entityType}`,query=new URLSearchParams({organization_id:`eq.${org}`,provider:`eq.${provider}`,select:'id',limit:'1'}),existing=(await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[];
  if(existing[0])return existing[0].id;
  return (await insert('data_sources',{organization_id:org,source_type:'file',provider,name:entityType==='sales_order'?'판매 파일 업로드':entityType==='inventory_snapshot'?'재고 파일 업로드':entityType==='product_review'?'리뷰·VOC 파일 업로드':'상품 마스터 파일 업로드',status:'active',data_mode:'connected',sync_mode:'manual',config:{entity_type:entityType},created_by:userId}))?.[0]?.id;
}

async function persistRawFile(file:File,fileBytes:ArrayBuffer,checksum:string,org:string,userId:string,sourceId:string,entityType:string){
  const uploadId=crypto.randomUUID(),safeName=storageSafeFilename(file.name),storagePath=`${org}/${uploadId}/${safeName}`;
  await supabase(`/storage/v1/object/raw-imports/${encodeURI(storagePath)}`,{serviceRole:true,method:'POST',headers:{'content-type':file.type||'application/octet-stream','x-upsert':'false'},body:fileBytes});
  return (await insert('raw_uploads',{id:uploadId,organization_id:org,data_source_id:sourceId,uploaded_by:userId,original_filename:file.name,storage_path:storagePath,content_type:file.type||null,byte_size:file.size,checksum,entity_type:entityType,status:'processing'}))?.[0];
}

export function storageSafeFilename(filename:string){
  const raw=String(filename||'source-data.csv'),dot=raw.lastIndexOf('.'),extension=dot>0?raw.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g,''):'';
  const base=(dot>0?raw.slice(0,dot):raw).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/[-_.]{2,}/g,'-').replace(/^[-_.]+|[-_.]+$/g,'').slice(0,80)||'source-data';
  return `${base}${extension||'.csv'}`;
}

async function findCompletedUpload(org:string,entityType:string,checksum:string){const query=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,checksum:`eq.${checksum}`,status:'eq.completed',select:'id,created_at,original_filename',order:'created_at.desc',limit:'5'}),uploads=((await supabase(`/rest/v1/raw_uploads?${query}`,{serviceRole:true})).data||[]);for(const upload of uploads){const job=await findImportJob(upload.id);if(job?.status==='completed')return upload}return null}
async function findMappingTemplate(org:string,entityType:string,signature:string,requestedSourceId:string|null){
  if(requestedSourceId){const specific=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:`eq.${requestedSourceId}`,active:'eq.true',select:'id,name,version,mapping,data_source_id',order:'version.desc,created_at.desc',limit:'1'}),row=((await supabase(`/rest/v1/mapping_templates?${specific}`,{serviceRole:true})).data||[])[0];if(row)return row}
  const generic=new URLSearchParams({organization_id:`eq.${org}`,entity_type:`eq.${entityType}`,header_signature:`eq.${signature}`,data_source_id:'is.null',active:'eq.true',select:'id,name,version,mapping,data_source_id',order:'version.desc,created_at.desc',limit:'1'});
  return ((await supabase(`/rest/v1/mapping_templates?${generic}`,{serviceRole:true})).data||[])[0]||null;
}
async function ensureConfirmedMappingTemplate(org:string,userId:string,entityType:string,signature:string,mapping:any,filename:string){
  const existing=await findMappingTemplate(org,entityType,signature,null);if(existing)return {template:existing,created:false};
  const base=String(filename||'회사 데이터').replace(/\.[^.]+$/,'').slice(0,60),template=(await insert('mapping_templates',{organization_id:org,data_source_id:null,name:`${base} · 확인된 매핑`,entity_type:entityType,header_signature:signature,mapping,transformations:{source:'confirmed_import'},version:1,active:true,created_by:userId}))?.[0];
  return {template,created:true};
}
async function findImportJob(uploadId:string){const query=new URLSearchParams({raw_upload_id:`eq.${uploadId}`,select:'id,status,total_rows,success_rows,error_rows,inserted_rows,updated_rows',order:'created_at.desc',limit:'1'}),row=((await supabase(`/rest/v1/import_jobs?${query}`,{serviceRole:true})).data||[])[0];return row?{id:row.id,status:row.status,totalRows:row.total_rows,successRows:row.success_rows,errorRows:row.error_rows,insertedRows:row.inserted_rows,updatedRows:row.updated_rows}:null}
async function sourceSummary(sourceId:string){const query=new URLSearchParams({id:`eq.${sourceId}`,select:'id,name,provider,status,data_mode,last_synced_at,last_successful_sync_at,last_sync_error',limit:'1'});return ((await supabase(`/rest/v1/data_sources?${query}`,{serviceRole:true})).data||[])[0]||null}
async function fetchMaster(table:string,field:string,codes:string[],org:string){if(!codes.length)return [];const filter=`in.(${codes.map(code=>`"${String(code).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&${field}=${encodeURIComponent(filter)}&select=id,${field}&limit=50000`;return (await supabase(`/rest/v1/${table}?${query}`,{serviceRole:true})).data||[]}
async function fetchOrders(ids:string[],org:string,sourceId:string){const rows:any[]=[];for(const group of chunks(ids,100)){const filter=`in.(${group.map(id=>`"${String(id).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&source_id=eq.${encodeURIComponent(sourceId)}&source_order_id=${encodeURIComponent(filter)}&select=id,source_order_id&limit=50000`;rows.push(...((await supabase(`/rest/v1/sales_orders?${query}`,{serviceRole:true})).data||[]))}return rows}
async function fetchSalesLines(orderIds:string[],org:string){const rows:any[]=[];for(const group of chunks(orderIds,100)){const filter=`in.(${group.map(id=>`"${String(id).replace(/"/g,'')}"`).join(',')})`,query=`organization_id=eq.${encodeURIComponent(org)}&order_id=${encodeURIComponent(filter)}&select=order_id,source_line_id&limit=50000`;rows.push(...((await supabase(`/rest/v1/sales_order_lines?${query}`,{serviceRole:true})).data||[]))}return rows}
function chunks<T>(items:T[],size:number){const result:T[][]=[];for(let index=0;index<items.length;index+=size)result.push(items.slice(index,index+size));return result}
function dedupe<T extends Record<string,any>>(items:T[],key:string){return [...new Map(items.map(item=>[item[key],item])).values()]}
function sum(items:any[],key:string){return items.reduce((total,item)=>total+Number(item[key]||0),0)}
function inferEntityMapping(entityType:string,headers:string[]){return entityType==='sales_order'?inferSalesMapping(headers):entityType==='inventory_snapshot'?inferMapping(headers):entityType==='product_review'?inferReviewMapping(headers):inferProductMapping(headers)}
function validateEntityRows(entityType:string,rows:Record<string,any>[],mapping:any){return entityType==='sales_order'?validateAndNormalizeSales(rows,mapping):entityType==='inventory_snapshot'?validateAndNormalize(rows,mapping):entityType==='product_review'?validateAndNormalizeReviews(rows,mapping):validateAndNormalizeProducts(rows,mapping)}
function inferPeriod(rows:any[],entityType:string){const field=entityType==='sales_order'?'sold_at':entityType==='inventory_snapshot'?'snapshot_at':entityType==='product_review'?'reviewed_at':null,values=field?rows.map(row=>row[field]).filter(Boolean).sort():[];return {start:values[0]||null,end:values.at(-1)||null}}
