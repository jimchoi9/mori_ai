import test from 'node:test';
import assert from 'node:assert/strict';
const client=await import(process.argv[2]);
globalThis.window=new EventTarget();
test('409 retains server resource details so unsaved captions can be compared',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:'최신 내용을 확인해주세요.',retryable:false,details:{resource_type:'page',resource_id:'page-a',current_version:12}},request_id:'req-409'}),{status:409});
 try{await assert.rejects(client.api('/albums/a/pages/page-a/caption',{method:'PATCH',body:{caption_text:'내 입력',expected_version:4}}),error=>{
  assert.equal(error.code,'VERSION_CONFLICT');
  assert.deepEqual(error.details,{resource_type:'page',resource_id:'page-a',current_version:12});
  assert.equal(error.requestId,'req-409');return true;
 });}finally{globalThis.fetch=previous;}
});
