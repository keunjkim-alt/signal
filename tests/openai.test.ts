import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisPlan} from '../api/_lib/openai.ts';

test('OpenAI 401 errors fall back without exposing the API key or blocking AX',async()=>{
  const previousKey=process.env.OPENAI_API_KEY;
  const previousFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='test-invalid-key';
  globalThis.fetch=async()=>new Response(JSON.stringify({
    error:{
      code:'invalid_api_key',
      message:'Incorrect API key provided: sk-proj-secret-fragment'
    }
  }),{status:401,headers:{'content-type':'application/json'}});

  try{
    const result=await createAnalysisPlan('채널별 매출을 보여줘','hub');
    assert.equal(result.source,'heuristic');
    assert.equal(result.degraded,true);
    assert.equal(result.warningCode,'OPENAI_AUTH');
    assert.match(result.warning||'',/사전 계산 지표/);
    assert.doesNotMatch(JSON.stringify(result),/sk-proj-secret-fragment/);
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=previousKey;
  }
});

test('OpenAI timeout falls back to the deterministic router',async()=>{
  const previousKey=process.env.OPENAI_API_KEY,previousTimeout=process.env.OPENAI_ROUTER_TIMEOUT_MS,previousFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='test-key';process.env.OPENAI_ROUTER_TIMEOUT_MS='2500';
  globalThis.fetch=async()=>{const error:any=new Error('aborted');error.name='AbortError';throw error};
  try{
    const result=await createAnalysisPlan('제품별 판매 추이를 비교해줘','sales');
    assert.equal(result.source,'heuristic');
    assert.equal(result.degraded,true);
    assert.equal(result.warningCode,'OPENAI_TIMEOUT');
    assert.equal(result.dimension,'product');
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
    if(previousTimeout===undefined)delete process.env.OPENAI_ROUTER_TIMEOUT_MS;else process.env.OPENAI_ROUTER_TIMEOUT_MS=previousTimeout;
  }
});

test('AX router uses the low-latency structured-output model role',async()=>{
  const previousKey=process.env.OPENAI_API_KEY,previousModel=process.env.OPENAI_ROUTER_MODEL,previousFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='test-key';delete process.env.OPENAI_ROUTER_MODEL;let requestBody:any;
  globalThis.fetch=async(_url,options:any)=>{requestBody=JSON.parse(options.body);return new Response(JSON.stringify({model:'gpt-5.6-luna',output_text:JSON.stringify({metric:'net_sales',dimension:'channel',visualization:'bar',periodDays:7,filters:{country:null,channel:null,platform:null},limit:20,title:'채널별 매출',explanation:'채널별 매출을 조회합니다.'})}),{status:200,headers:{'content-type':'application/json'}})};
  try{
    const result=await createAnalysisPlan('채널별 매출을 비교해서 판단해줘','hub',{}, {conversationContext:{metric:'quantity',periodDays:30},recentMessages:[{role:'user',content:'제품별 판매량을 보여줘'}]});
    assert.equal(result.source,'openai');
    assert.equal(requestBody.model,'gpt-5.6-luna');
    assert.equal(requestBody.reasoning.effort,'none');
    assert.equal(requestBody.max_output_tokens,500);
    assert.equal(requestBody.text.verbosity,'low');
    assert.equal(requestBody.store,false);
    const routedInput=JSON.parse(requestBody.input[1].content[0].text);
    assert.equal(routedInput.conversationContext.metric,'quantity');
    assert.equal(routedInput.recentMessages[0].content,'제품별 판매량을 보여줘');
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
    if(previousModel===undefined)delete process.env.OPENAI_ROUTER_MODEL;else process.env.OPENAI_ROUTER_MODEL=previousModel;
  }
});
