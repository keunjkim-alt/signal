const base=String(process.env.BETA_BASE_URL||'https://signal.viimstudio.ai').replace(/\/$/,''),email=process.env.BETA_TEST_EMAIL,password=process.env.BETA_TEST_PASSWORD;
if(!email||!password){console.error('BETA_TEST_EMAIL and BETA_TEST_PASSWORD are required.');process.exit(2)}

const checks=[];
const record=(name,ok,detail={})=>{checks.push({name,ok,...detail});if(!ok)process.exitCode=1};
const readJson=async response=>{const text=await response.text();try{return text?JSON.parse(text):{}}catch{return {raw:text}}};
const permissionFor=(user,page)=>Array.isArray(user?.permissions)?user.permissions.find(item=>item.page_key===page):null;

const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})}),loginBody=await readJson(login);
record('login',login.ok,{status:login.status,role:loginBody?.user?.role||null});
if(!login.ok){console.log(JSON.stringify({base,checks},null,2));process.exit(1)}

const setCookies=typeof login.headers.getSetCookie==='function'?login.headers.getSetCookie():[login.headers.get('set-cookie')||''],cookie=setCookies.map(value=>value.split(';')[0]).filter(Boolean).join('; ');
const request=async(name,path,{method='GET',body,expect=200,validate=()=>true,workspaceId}={})=>{
  const headers={cookie,'content-type':'application/json'};
  if(workspaceId)headers['x-viimsignal-workspace-id']=workspaceId;
  const response=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),payload=await readJson(response),ok=response.status===expect&&validate(payload);
  record(name,ok,{status:response.status,expected:expect,error:ok?null:payload?.error||payload?.raw||'validation failed'});
  return payload;
};

const session=await request('authenticated session','/api/auth/session',{validate:body=>body?.ok&&body?.authenticated&&body?.user?.role==='viewer'}),user=session?.user||{},workspaces=Array.isArray(user.workspaces)?user.workspaces:[];
record('single workspace scope',workspaces.length===1,{workspaceCount:workspaces.length,workspace:workspaces[0]?.name||null});
record('read-only permission matrix',Array.isArray(user.permissions)&&user.permissions.length>0&&user.permissions.every(item=>item.can_update===false&&item.can_approve===false),{permissionCount:Array.isArray(user.permissions)?user.permissions.length:0});
record('admin pages hidden',permissionFor(user,'permissions')?.can_view!==true&&permissionFor(user,'connections')?.can_view!==true&&permissionFor(user,'execution')?.can_view!==true);

const workspaceId=workspaces[0]?.id;
await request('sales hub allowed','/api/dashboards/query',{workspaceId,validate:body=>body?.ok&&body?.hasData===true});
await request('today actions allowed','/api/dashboards/query?resource=decision-actions',{workspaceId,validate:body=>body?.ok&&Array.isArray(body?.actions)});
await request('permission administration denied','/api/permissions/users',{expect:403});
await request('data connections denied','/api/integrations/sources',{expect:403});
await request('execution page denied','/api/decisions/workflow?page=execution',{expect:403});
await request('approval mutation denied before lookup','/api/dashboards/query?resource=decision-actions',{method:'POST',workspaceId,expect:403,body:{actionKey:'permission-smoke:nonexistent',decision:'approved'}});

const passed=checks.filter(item=>item.ok).length;
console.log(JSON.stringify({base,account:email,passed,total:checks.length,ready:passed===checks.length,checks},null,2));
