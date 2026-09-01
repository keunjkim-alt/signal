import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const base=String(process.env.BETA_BASE_URL||'https://signal.viimstudio.ai').replace(/\/$/,'');
const maxLatency=Math.max(500,Number(process.env.BETA_PUBLIC_MAX_MS)||5000);
const reportPath=String(process.env.BETA_PUBLIC_REPORT_PATH||'').trim();
const checks=[];

async function check(name,path,validate){
  const started=Date.now();
  try{
    const response=await fetch(`${base}${path}`,{headers:{accept:'*/*','user-agent':'VIIMsignal-beta-check/1.0'}});
    const text=await response.text();
    let body=text;try{body=text?JSON.parse(text):null}catch{}
    const durationMs=Date.now()-started,valid=Boolean(validate({response,text,body})),withinLatency=durationMs<=maxLatency;
    checks.push({name,path,ok:response.ok&&valid&&withinLatency,status:response.status,durationMs,withinLatency,detail:response.ok?(valid?'validated':'content validation failed'):`HTTP ${response.status}`});
  }catch(error){checks.push({name,path,ok:false,status:0,durationMs:Date.now()-started,withinLatency:false,detail:error?.message||String(error)})}
}

await check('API health','/api/health',({body})=>body?.ok===true&&body?.service==='viimsignal-api'&&body?.backendConfigured===true);
await check('Frontend shell','/',({text})=>text.includes('VIIMsignal')&&text.includes('color-palette.css')&&text.includes('app.js'));
await check('Sales onboarding file','/assets/templates/closed-beta/VIIMsignal_Closed_Beta_Sales_30D.csv',({text})=>text.startsWith('sold_at,channel_code,sku_code,quantity,net_sales'));
await check('Inventory onboarding file','/assets/templates/closed-beta/VIIMsignal_Closed_Beta_Inventory.csv',({text})=>text.startsWith('sku_code,location_code,location_name,snapshot_at'));
await check('Field mapping file','/assets/templates/closed-beta/VIIMsignal_Beta_Field_Mapping.csv',({text})=>text.startsWith('entity_type,standard_field,required'));
await check('Quick start guide','/assets/templates/closed-beta/VIIMsignal_Beta_Quick_Start.txt',({text})=>text.includes('VIIMsignal')&&text.includes('로그인'));
await check('Scenario baseline sales pack v2','/assets/templates/closed-beta/scenario-packs/VIIMsignal_Pack1_Baseline_Sales_90D_v2.csv',({text})=>text.startsWith('sold_at,channel_code,sku_code,quantity,net_sales')&&text.includes('data_pack_version'));
await check('Scenario event inventory pack v2','/assets/templates/closed-beta/scenario-packs/VIIMsignal_Pack2_Event_Inventory_14D_v2.csv',({text})=>text.startsWith('sku_code,location_code,location_name,snapshot_at')&&text.includes('data_pack_version'));

const report={service:'VIIMsignal',gate:'closed-beta-public',base,measuredAt:new Date().toISOString(),maxLatencyMs:maxLatency,ready:checks.every(item=>item.ok),checks};
if(reportPath){const target=resolve(reportPath);await mkdir(dirname(target),{recursive:true});await writeFile(target,`${JSON.stringify(report,null,2)}\n`)}
console.log(JSON.stringify(report,null,2));
if(!report.ready)process.exitCode=1;
