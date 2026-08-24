const base=String(process.env.BETA_BASE_URL||'https://signal.viimstudio.ai').replace(/\/$/,''),email=process.env.BETA_TEST_EMAIL,password=process.env.BETA_TEST_PASSWORD,includeAx=process.env.BETA_SMOKE_AX==='1';
if(!email||!password){console.error('BETA_TEST_EMAIL and BETA_TEST_PASSWORD are required.');process.exit(2)}

const checks=[];
const record=(name,ok,detail={})=>{checks.push({name,ok,...detail});if(!ok)process.exitCode=1};
const json=async response=>{const text=await response.text();try{return text?JSON.parse(text):{}}catch{return {raw:text}}};

const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})}),loginBody=await json(login);
record('login',login.ok,{status:login.status,role:loginBody?.user?.role||null});
if(!login.ok){console.log(JSON.stringify({base,checks},null,2));process.exit(1)}
const setCookies=typeof login.headers.getSetCookie==='function'?login.headers.getSetCookie():[login.headers.get('set-cookie')||''],cookie=setCookies.map(value=>value.split(';')[0]).filter(Boolean).join('; ');
const request=async(name,path,validate=body=>body?.ok===true,options={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{cookie,'content-type':'application/json',...(options.headers||{})}}),body=await json(response),ok=response.ok&&validate(body);record(name,ok,{status:response.status,source:body?.source||null,error:ok?null:body?.error||body?.raw||'validation failed'});return body};

await request('session','/api/auth/session',body=>body?.ok&&body?.authenticated&&body?.user?.organizationId);
await request('data sources','/api/integrations/sources',body=>body?.ok&&Array.isArray(body?.sources));
await request('mapping templates','/api/integrations/sources?resource=mappings',body=>body?.ok&&Array.isArray(body?.templates)&&body.templates.some(row=>row.entity_type==='sales_order')&&body.templates.some(row=>row.entity_type==='inventory_snapshot'));
await request('data reconciliation','/api/integrations/sources?resource=data-quality',body=>body?.ok&&body?.blocked===false&&body?.status==='healthy');
await request('sales hub','/api/dashboards/query',body=>body?.ok&&body?.hasData&&Number(body?.summary?.quantity)>0);
await request('profitability','/api/dashboards/query?resource=profitability-summary',body=>body?.ok&&Number(body?.readiness?.totalLines)>0);
await request('customer regions','/api/dashboards/query?resource=customer-insights',body=>body?.ok&&body?.hasData&&Array.isArray(body?.regions));
await request('returns','/api/dashboards/query?resource=return-insights',body=>body?.ok&&body?.hasData&&Array.isArray(body?.channels));
await request('inventory','/api/dashboards/query?resource=inventory-operations',body=>body?.ok&&body?.hasData&&body?.products?.length>0);
await request('today actions','/api/dashboards/query?resource=decision-actions',body=>body?.ok&&Array.isArray(body?.actions));
await request('inventory workflows','/api/dashboards/query?resource=inventory-workflows',body=>body?.ok&&body?.summary&&Array.isArray(body?.transfers));
await request('production workflows','/api/dashboards/query?resource=production-workflows',body=>body?.ok&&body?.summary&&Array.isArray(body?.orders));
await request('market intelligence','/api/dashboards/query?resource=product-intelligence&page=market',body=>body?.ok&&Array.isArray(body?.matches));
await request('discount intelligence','/api/dashboards/query?resource=discount-intelligence',body=>body?.ok&&Array.isArray(body?.recommendations));
await request('AX history','/api/ax/history',body=>body?.ok&&Array.isArray(body?.conversations));
await request('audit history','/api/permissions/users?resource=audit&limit=20',body=>body?.ok&&Array.isArray(body?.events)&&body.events.length>0);
await request('closed beta readiness','/api/permissions/users?resource=readiness',body=>body?.ok&&body?.ready===true&&body?.score===100);
if(includeAx)await request('AX live answer','/api/ax/query',body=>body?.ok&&body?.answer&&body?.conversationId,{method:'POST',body:JSON.stringify({question:'최근 14일 고판매·부족재고 상품을 보여줘',page:'inventory',filters:{country:'전체 국가',channel:'전체 채널'}})});

const passed=checks.filter(item=>item.ok).length;
console.log(JSON.stringify({base,passed,total:checks.length,ready:passed===checks.length,checks},null,2));
