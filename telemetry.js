(()=>{
  const SOURCE_KEY='viimsignalPerformance',SENT_KEY='viimsignalPerformanceSent';let admin=false;
  const safeJson=(value,fallback)=>{try{return JSON.parse(value)}catch{return fallback}},metricKey=row=>`${row.at}|${row.type}|${row.name}|${row.durationMs}|${row.status}`;
  async function flush(){
    const rows=safeJson(sessionStorage.getItem(SOURCE_KEY)||'[]',[]),sent=new Set(safeJson(sessionStorage.getItem(SENT_KEY)||'[]',[])),pending=rows.filter(row=>!sent.has(metricKey(row))).slice(-50);if(!pending.length)return;
    try{const response=await fetch('/api/health?resource=operations',{method:'POST',credentials:'include',keepalive:true,headers:{'content-type':'application/json'},body:JSON.stringify({entries:pending})});if(!response.ok)return;const next=[...sent,...pending.map(metricKey)].slice(-300);sessionStorage.setItem(SENT_KEY,JSON.stringify(next))}catch{}
  }
  function ensureAdminLink(){
    if(!admin||document.querySelector('[data-operations-monitor]'))return;const sidebar=document.querySelector('.sidebar .sidebar-scroll'),navs=sidebar?.querySelectorAll('nav');if(!sidebar||!navs?.length)return;const link=document.createElement('a');link.dataset.operationsMonitor='true';link.href='/operations.html';link.textContent='운영 모니터링';link.style.cssText='display:block;margin-top:4px;border-radius:10px;padding:11px 14px;color:inherit;text-decoration:none;font-size:12px;background:rgba(255,255,255,.06)';navs[navs.length-1].append(link);
  }
  fetch('/api/auth/session',{credentials:'include'}).then(response=>response.json()).then(body=>{admin=['owner','admin'].includes(body?.user?.role);ensureAdminLink()}).catch(()=>{});
  new MutationObserver(ensureAdminLink).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(flush,20000);window.addEventListener('online',flush);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});setTimeout(flush,5000);
})();
