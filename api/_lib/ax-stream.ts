export type AxStreamEvent={type:'status'|'answer_delta'|'complete'|'error';phase?:string;delta?:string;payload?:any;error?:string;status?:number};

export function encodeAxStreamEvent(event:AxStreamEvent){return `${JSON.stringify(event)}\n`}

export function answerChunks(answer:string){
  const chunks=String(answer||'').match(/[^.!?。！？]+[.!?。！？]?\s*/g)?.map(value=>value.trim()).filter(Boolean)||[];
  return chunks.length?chunks:[String(answer||'')];
}
