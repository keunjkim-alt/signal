import {json} from '../http.js';
import {isConnectorSystemRequest} from '../connector-auth.js';
import {supabase} from '../supabase.js';
import {refreshOrganizationOutcomes} from '../outcome-refresh.js';

export default {async fetch(request:Request){if(!['GET','POST'].includes(request.method))return json({ok:false,error:'Method not allowed'},405);if(!isConnectorSystemRequest(request))return json({ok:false,error:'Unauthorized'},401);const pending:any[]=(await supabase('/rest/v1/recommendation_outcomes?outcome_status=in.(pending,measuring)&select=organization_id&limit=10000',{serviceRole:true})).data||[],organizations:string[]=[...new Set(pending.map((row:any)=>String(row.organization_id)))],asOfDate=new Date().toISOString().slice(0,10),results:any[]=[];for(const organizationId of organizations)try{results.push({organizationId,ok:true,...await refreshOrganizationOutcomes(organizationId,asOfDate)})}catch(error:any){results.push({organizationId,ok:false,error:String(error.message||error)})}return json({ok:results.every(row=>row.ok),asOfDate,organizations:organizations.length,results})}};
