const baseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetEmail=String(process.env.BETA_DIAG_EMAIL||'').trim().toLowerCase();

if(!baseUrl||!serviceKey){
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}
if(!targetEmail){
  console.error('BETA_DIAG_EMAIL is required.');
  process.exit(2);
}

const headers={apikey:serviceKey,authorization:`Bearer ${serviceKey}`,accept:'application/json'};
async function get(path){
  const response=await fetch(`${baseUrl}${path}`,{headers});
  const text=await response.text();
  let data;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw new Error(data?.message||data?.error||`Supabase ${response.status}`);
  return data;
}
const query=(table,params)=>get(`/rest/v1/${table}?${new URLSearchParams(params)}`);

const authPage=await get('/auth/v1/admin/users?page=1&per_page=1000');
const user=(authPage?.users||[]).find(candidate=>String(candidate.email||'').toLowerCase()===targetEmail);
if(!user){
  console.error(`No auth user found for ${targetEmail}.`);
  process.exit(1);
}

const memberships=await query('organization_memberships',{
  user_id:`eq.${user.id}`,
  status:'eq.active',
  select:'id,organization_id,role,team_code,data_scope,organizations(id,name,slug)'
});
const membership=memberships[0];
if(!membership){
  console.error(`No active organization membership found for ${targetEmail}.`);
  process.exit(1);
}

const organizationId=membership.organization_id,organizationFilter=`eq.${organizationId}`;
const [snapshots,skus,products,locations,orders,lines,sources,jobs,uploads,mappings,members,permissions,runs,conversations,audits,recommendations,transfers]=await Promise.all([
  query('inventory_snapshots',{organization_id:organizationFilter,select:'id,sku_id,location_id,snapshot_at,available_qty',order:'snapshot_at.desc',limit:'10000'}),
  query('skus',{organization_id:organizationFilter,select:'id,sku_code,product_id',limit:'5000'}),
  query('products',{organization_id:organizationFilter,select:'id,product_code,product_name',limit:'5000'}),
  query('locations',{organization_id:organizationFilter,select:'id,location_code,location_name,country_code',limit:'5000'}),
  query('sales_orders',{organization_id:organizationFilter,select:'id,ordered_at,location_id,channel_code,country_code',limit:'10000'}),
  query('sales_order_lines',{organization_id:organizationFilter,select:'id,order_id,sku_id,quantity',limit:'20000'}),
  query('data_sources',{organization_id:organizationFilter,select:'id,name,provider,status,data_mode,last_successful_sync_at',order:'last_synced_at.desc.nullslast'}),
  query('import_jobs',{organization_id:organizationFilter,select:'id,raw_upload_id,entity_type,status,total_rows,success_rows,error_rows,summary,completed_at,created_at',order:'created_at.desc',limit:'100'}),
  query('raw_uploads',{organization_id:organizationFilter,select:'id,original_filename,entity_type,status,created_at',order:'created_at.desc',limit:'100'}),
  query('mapping_templates',{organization_id:organizationFilter,active:'eq.true',select:'id,name,entity_type,header_signature,version,created_at',limit:'1000'}),
  query('organization_memberships',{organization_id:organizationFilter,status:'eq.active',select:'id,role,team_code',limit:'1000'}),
  query('page_permissions',{organization_id:organizationFilter,select:'id,membership_id,page_key,can_view,can_update,can_approve',limit:'10000'}),
  query('analytics_refresh_runs',{organization_id:organizationFilter,select:'id,pipeline,status,error_message,started_at,completed_at',order:'started_at.desc',limit:'100'}),
  query('ax_conversations',{organization_id:organizationFilter,select:'id,created_at',limit:'10000'}),
  query('audit_logs',{organization_id:organizationFilter,select:'id,action,created_at',order:'created_at.desc',limit:'20000'}),
  query('ax_recommendations',{organization_id:organizationFilter,select:'id,recommendation_key,page_key,status,payload,approved_at',limit:'2000'}),
  query('transfer_orders',{organization_id:organizationFilter,select:'id,status,created_at',limit:'2000'})
]);

const skuIds=new Set(skus.map(row=>String(row.id))),productIds=new Set(products.map(row=>String(row.id))),locationIds=new Set(locations.map(row=>String(row.id))),orderIds=new Set(orders.map(row=>String(row.id)));
const latestSnapshotAt=snapshots.map(row=>row.snapshot_at).filter(Boolean).sort().at(-1)||null;
const inventorySources=sources.filter(source=>String(source.provider||'').includes('inventory'));
const salesSources=sources.filter(source=>String(source.provider||'').includes('sales'));
const uploadMap=new Map(uploads.map(row=>[String(row.id),row])),recentImports=jobs.slice(0,10).map(job=>({...job,filename:uploadMap.get(String(job.raw_upload_id))?.original_filename||null})),approved=recommendations.filter(row=>['approved','executed'].includes(row.status)),productionOrders=approved.filter(row=>row.page_key==='inventory'&&String(row.recommendation_key||'').startsWith('reorder:')&&row.payload?.kind==='reorder'&&Number(row.payload?.quantity||0)>0),reorderIntegrityIssues=approved.filter(row=>row.page_key==='inventory'&&String(row.recommendation_key||'').startsWith('reorder:')&&(row.payload?.kind!=='reorder'||Number(row.payload?.quantity||0)<=0||!row.payload?.product_code||!row.payload?.production_status)),latestImport=type=>jobs.find(job=>job.entity_type===type&&['completed','partial'].includes(job.status)),latestRuns=new Map();for(const run of runs)if(!latestRuns.has(String(run.pipeline)))latestRuns.set(String(run.pipeline),run);

console.log(JSON.stringify({
  user:{email:targetEmail,id:user.id},
  organization:{id:organizationId,name:membership.organizations?.name||null,slug:membership.organizations?.slug||null},
  membership:{role:membership.role,teamCode:membership.team_code||null,dataScope:membership.data_scope||null},
  counts:{products:products.length,skus:skus.length,locations:locations.length,salesOrders:orders.length,salesOrderLines:lines.length,inventorySnapshots:snapshots.length},
  integrity:{
    snapshotsMissingSku:snapshots.filter(row=>!skuIds.has(String(row.sku_id))).length,
    snapshotsMissingLocation:snapshots.filter(row=>!locationIds.has(String(row.location_id))).length,
    skusMissingProduct:skus.filter(row=>row.product_id&&!productIds.has(String(row.product_id))).length,
    linesMissingOrder:lines.filter(row=>!orderIds.has(String(row.order_id))).length,
    linesMissingSku:lines.filter(row=>!skuIds.has(String(row.sku_id))).length
  },
  freshness:{latestSnapshotAt,inventorySources,salesSources},
  readinessSignals:{
    activeMembers:members.length,ownerAdmins:members.filter(row=>['owner','admin'].includes(row.role)).length,permissionRules:permissions.length,
    mappings:{sales:mappings.filter(row=>row.entity_type==='sales_order').length,inventory:mappings.filter(row=>row.entity_type==='inventory_snapshot').length},
    reconciliation:{sales:latestImport('sales_order')?.summary?.reconciliation?.status||'missing',inventory:latestImport('inventory_snapshot')?.summary?.reconciliation?.status||'missing'},
    analytics:{pipelines:latestRuns.size,latestFailures:[...latestRuns.values()].filter(row=>row.status==='failed')},
    axConversations:conversations.length,auditEvents:audits.length,approvedActions:approved.length+transfers.filter(row=>['approved','in_transit','completed'].includes(row.status)).length,productionOrders:productionOrders.length,reorderIntegrityIssues:reorderIntegrityIssues.length
  },
  recentImports
},null,2));
