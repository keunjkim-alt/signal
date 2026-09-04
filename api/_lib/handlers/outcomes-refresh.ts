import {bodyJson,errorResponse,json} from '../http.js';
import {audit,requestContext,requireRole} from '../supabase.js';
import {refreshOrganizationOutcomes} from '../outcome-refresh.js';

export default {async fetch(request:Request){if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);try{const context=await requestContext(request);requireRole(context,['owner','admin']);const body=await bodyJson(request)||{},asOfDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.asOfDate||''))?String(body.asOfDate):new Date().toISOString().slice(0,10),result=await refreshOrganizationOutcomes(context.membership.organization_id,asOfDate);await audit(context,'recommendation.outcomes_refreshed','analytics_pipeline',undefined,{asOfDate,...result});return json({ok:true,asOfDate,...result})}catch(error:any){return errorResponse(error,error.status||500)}}};
