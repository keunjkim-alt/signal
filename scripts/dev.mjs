import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd(),port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(request,response)=>{try{const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),requested=path.join(root,pathname==='/'?'index.html':pathname);let file=requested;if(!file.startsWith(root))throw new Error('Forbidden');try{if(!(await stat(file)).isFile())file=path.join(root,'index.html')}catch{file=path.join(root,'index.html')}const data=await readFile(file);response.setHeader('content-type',types[path.extname(file)]||'application/octet-stream');response.end(data)}catch(error){response.statusCode=500;response.end(String(error))}}).listen(port,'127.0.0.1',()=>console.log(`VIIMsginal static dev server: http://127.0.0.1:${port}`));

