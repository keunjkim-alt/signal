export function readCookies(request:Request){
  const value=request.headers.get('cookie')||'';
  return Object.fromEntries(value.split(';').map(part=>part.trim()).filter(Boolean).map(part=>{const index=part.indexOf('=');return [decodeURIComponent(part.slice(0,index)),decodeURIComponent(part.slice(index+1))]}));
}

export function authCookies(request:Request,accessToken:string,refreshToken:string,expiresIn=3600){
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return [
    `fashion_ax_access=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(60,expiresIn-30)}${secure}`,
    `fashion_ax_refresh=${encodeURIComponent(refreshToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
  ];
}

export function clearAuthCookies(request:Request){
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return [`fashion_ax_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,`fashion_ax_refresh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`];
}

