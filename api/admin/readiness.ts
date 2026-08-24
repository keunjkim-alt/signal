import {evaluateClosedBetaReadiness} from '../_lib/closed-beta-readiness.js';
import {errorResponse,json} from '../_lib/http.js';
import {requestContext,requireRole,supabase} from '../_lib/supabase.js';

export default {async fetch(request:Request){
  try{
    if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);
    const context=await requestContext(request);requireRole(context,['owner','admin']);const org=context.membership.organization_id;
    const [members,permissions,orders,lines,snapshots,jobs,mappings,runs,conversations,audits,recommendations,transfers,sources]=await Promise.all([
      rows('organization_memberships',{organization_id:`eq.${org}`,status:'eq.active',select:'id,role'}),
      rows('page_permissions',{organization_id:`eq.${org}`,select:'id,membership_id,page_key'}),
      rows('sales_orders',{organization_id:`eq.${org}`,select:'id',limit:'20000'}),
      rows('sales_order_lines',{organization_id:`eq.${org}`,select:'id',limit:'50000'}),
      rows('inventory_snapshots',{organization_id:`eq.${org}`,select:'id',limit:'50000'}),
      rows('import_jobs',{organization_id:`eq.${org}`,entity_type:'in.(sales_order,inventory_snapshot)',select:'id,entity_type,status,summary,completed_at,created_at',order:'created_at.desc',limit:'100'}),
      rows('mapping_templates',{organization_id:`eq.${org}`,active:'eq.true',entity_type:'in.(sales_order,inventory_snapshot)',select:'id,entity_type',limit:'1000'}),
      rows('analytics_refresh_runs',{organization_id:`eq.${org}`,select:'id,pipeline,status,error_message,started_at,completed_at',order:'started_at.desc',limit:'100'}),
      rows('ax_conversations',{organization_id:`eq.${org}`,select:'id',limit:'10000'}),
      rows('audit_logs',{organization_id:`eq.${org}`,select:'id,action',limit:'20000'}),
      rows('ax_recommendations',{organization_id:`eq.${org}`,select:'id,recommendation_key,page_key,status,payload',order:'updated_at.desc',limit:'2000'}),
      rows('transfer_orders',{organization_id:`eq.${org}`,status:'in.(approved,in_transit,completed)',select:'id,status',limit:'2000'}),
      rows('data_sources',{organization_id:`eq.${org}`,select:'id,status,data_mode,last_sync_error',limit:'1000'})
    ]);
    const latestImport=(type:string)=>jobs.find((job:any)=>job.entity_type===type&&['completed','partial'].includes(job.status)),latestRuns=new Map<string,any>();for(const run of runs)if(!latestRuns.has(String(run.pipeline)))latestRuns.set(String(run.pipeline),run);
    const approvedRecommendations=recommendations.filter((row:any)=>['approved','executed'].includes(row.status)),productionOrders=approvedRecommendations.filter((row:any)=>row.page_key==='inventory'&&String(row.recommendation_key||'').startsWith('reorder:')&&row.payload?.kind==='reorder'&&Number(row.payload?.quantity||0)>0),integrityIssues=approvedRecommendations.filter((row:any)=>row.page_key==='inventory'&&String(row.recommendation_key||'').startsWith('reorder:')&&(row.payload?.kind!=='reorder'||Number(row.payload?.quantity||0)<=0||!row.payload?.product_code||!row.payload?.production_status));
    const input={
      activeMembers:members.length,ownerAdmins:members.filter((row:any)=>['owner','admin'].includes(row.role)).length,scopedMembers:members.filter((row:any)=>!['owner','admin'].includes(row.role)).length,permissionRows:permissions.length,
      salesOrders:orders.length,salesLines:lines.length,inventorySnapshots:snapshots.length,
      completedSalesImports:jobs.filter((row:any)=>row.entity_type==='sales_order'&&['completed','partial'].includes(row.status)).length,completedInventoryImports:jobs.filter((row:any)=>row.entity_type==='inventory_snapshot'&&['completed','partial'].includes(row.status)).length,
      salesMappings:mappings.filter((row:any)=>row.entity_type==='sales_order').length,inventoryMappings:mappings.filter((row:any)=>row.entity_type==='inventory_snapshot').length,
      salesReconciliation:reconciliationStatus(latestImport('sales_order')),inventoryReconciliation:reconciliationStatus(latestImport('inventory_snapshot')),
      analyticsRuns:latestRuns.size,analyticsFailures:[...latestRuns.values()].filter((row:any)=>row.status==='failed').length,
      axConversations:conversations.length,auditEvents:audits.length,approvedActions:approvedRecommendations.length+transfers.length,productionOrders:productionOrders.length,reorderIntegrityIssues:integrityIssues.length,
      sourceErrors:sources.filter((row:any)=>row.status==='error'||row.data_mode==='stale').length,openaiConfigured:Boolean(process.env.OPENAI_API_KEY)
    };
    return json({ok:true,organizationId:org,...evaluateClosedBetaReadiness(input),metrics:input,operations:{latestImports:{sales:latestImport('sales_order')||null,inventory:latestImport('inventory_snapshot')||null},latestAnalytics:[...latestRuns.values()],sourceErrors:sources.filter((row:any)=>row.status==='error'||row.data_mode==='stale')}});
  }catch(error:any){return errorResponse(error,error.status||500)}
}};

async function rows(table:string,params:Record<string,string>){return (await supabase(`/rest/v1/${table}?${new URLSearchParams(params)}`,{serviceRole:true})).data||[]}
function reconciliationStatus(job:any):'matched'|'mismatch'|'missing'{const value=job?.summary?.reconciliation?.status;return value==='matched'?'matched':value==='mismatch'?'mismatch':'missing'}
