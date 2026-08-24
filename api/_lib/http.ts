export const json=(data:any,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});

export async function bodyJson(request:Request){
  try{return await request.json()}catch{return null}
}

export function cors(request:Request){
  const origin=request.headers.get('origin')||'';
  return {'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','vary':'Origin'};
}

export function errorResponse(error:any,status=500){
  const message=error instanceof Error?error.message:String(error||'Unknown error');
  return json({ok:false,error:message},status);
}

