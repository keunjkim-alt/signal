import queryHandler from './query.js';
import {answerChunks,encodeAxStreamEvent,type AxStreamEvent} from '../_lib/ax-stream.js';

const encoder=new TextEncoder();

export default {async fetch(request:Request){
  if(request.method!=='POST')return new Response(encodeAxStreamEvent({type:'error',error:'Method not allowed',status:405}),{status:405,headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store'}});
  const stream=new ReadableStream({start(controller){
    const send=(event:AxStreamEvent)=>controller.enqueue(encoder.encode(encodeAxStreamEvent(event)));
    send({type:'status',phase:'질문과 권한 범위를 확인하고 있습니다'});
    (async()=>{
      try{
        const response=await queryHandler.fetch(request),payload=await response.json();
        if(!response.ok){send({type:'error',error:payload?.error||`AX ${response.status}`,status:response.status});return}
        send({type:'status',phase:'결과를 비교하고 실행안을 정리하고 있습니다'});
        for(const delta of answerChunks(payload.answer)){send({type:'answer_delta',delta});await Promise.resolve()}
        send({type:'complete',payload,status:response.status});
      }catch(error:any){send({type:'error',error:String(error?.message||'AX 분석 요청에 실패했습니다.'),status:Number(error?.status||500)})}
      finally{controller.close()}
    })();
  }});
  return new Response(stream,{status:200,headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
}};
