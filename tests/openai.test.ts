import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisPlan} from '../api/_lib/openai.ts';

test('OpenAI 401 errors are sanitized and mapped to a gateway error',async()=>{
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
    await assert.rejects(
      ()=>createAnalysisPlan('채널별 매출을 보여줘','hub'),
      (error:any)=>{
        assert.equal(error.status,502);
        assert.equal(error.code,'invalid_api_key');
        assert.match(error.message,/API 키가 유효하지 않습니다/);
        assert.doesNotMatch(error.message,/sk-proj-secret-fragment/);
        return true;
      }
    );
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY=previousKey;
  }
});

test('AX router uses the low-latency structured-output model role',async()=>{
  const previousKey=process.env.OPENAI_API_KEY,previousModel=process.env.OPENAI_ROUTER_MODEL,previousFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='test-key';delete process.env.OPENAI_ROUTER_MODEL;let requestBody:any;
  globalThis.fetch=async(_url,options:any)=>{requestBody=JSON.parse(options.body);return new Response(JSON.stringify({model:'gpt-5.6-luna',output_text:JSON.stringify({metric:'net_sales',dimension:'channel',visualization:'bar',periodDays:7,filters:{country:null,channel:null,platform:null},limit:20,title:'채널별 매출',explanation:'채널별 매출을 조회합니다.'})}),{status:200,headers:{'content-type':'application/json'}})};
  try{
    const result=await createAnalysisPlan('채널별 매출을 비교해서 판단해줘','hub');
    assert.equal(result.source,'openai');
    assert.equal(requestBody.model,'gpt-5.6-luna');
    assert.equal(requestBody.reasoning.effort,'none');
    assert.equal(requestBody.text.verbosity,'low');
    assert.equal(requestBody.store,false);
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
    if(previousModel===undefined)delete process.env.OPENAI_ROUTER_MODEL;else process.env.OPENAI_ROUTER_MODEL=previousModel;
  }
});
