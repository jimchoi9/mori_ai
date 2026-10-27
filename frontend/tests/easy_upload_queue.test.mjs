import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'easy-queue-'));
await build({entryPoints:['src/features/uploads/easyQueue.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'queue.mjs')});
await build({entryPoints:['src/features/uploads/easyTransport.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'transport.mjs')});
const {sendPhotos}=await import(join(dir,'queue.mjs'));
const {transferPhoto,verifyPhoto,retry}=await import(join(dir,'transport.mjs'));
const item=id=>({id,file:new File(['original'],`${id}.jpg`,{type:'image/jpeg'}),state:'selected'});
const prepared=()=>({file:new File(['optimized'],'ready.webp',{type:'image/webp',lastModified:1}),preprocessing:{version:2,original_width:100,original_height:100,captured_at_raw:null,captured_timezone:null}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('first transfer starts before the whole selection is prepared; one preparation ahead and two confirmations maximum',async()=>{
 const rows=Array.from({length:20},(_,i)=>item(String(i)));let made=0,active=0,peak=0,first=0,confirmed=0,checkPeak=0,checks=0;
 await sendPhotos(rows,new AbortController().signal,{
  prepare:async()=>{active++;peak=Math.max(peak,active);await tick();made++;active--;return prepared();},
  transfer:async row=>{if(!first)first=made;await tick();row.transferred=true;},
  verify:async()=>{checks++;checkPeak=Math.max(checkPeak,checks);await tick();checks--;confirmed++;},changed(){}
 });
 assert.ok(first<20);assert.equal(peak,1);assert.ok(checkPeak<=2);assert.equal(confirmed,20);assert.ok(rows.every(row=>row.state==='saved'&&!row.prepared));
});
test('one optimization failure and one transmission failure preserve those photos while others finish; retry skips saved files',async()=>{
 const rows=[item('a'),item('b'),item('c'),item('d')];let fail=true;const sent=[];
 const steps={prepare:async row=>{if(fail&&row.id==='b')throw Error('cannot optimize');return prepared();},transfer:async row=>{sent.push(row.id);if(fail&&row.id==='c')throw Error('offline');},changed(){}};
 await sendPhotos(rows,new AbortController().signal,steps);
 assert.deepEqual(rows.map(row=>row.state),['saved','failed','failed','saved']);assert.equal(rows[1].file.name,'b.jpg');const retained=rows[2].prepared;
 fail=false;await sendPhotos(rows,new AbortController().signal,steps);
 assert.deepEqual(sent,['a','c','d','b','c']);assert.ok(retained);assert.ok(rows.every(row=>row.state==='saved'));
});
test('an accepted upload is not called saved until server verification succeeds',async()=>{
 const row=item('a');let finish;
 const done=sendPhotos([row],new AbortController().signal,{prepare:async()=>prepared(),transfer:async()=>{},verify:()=>new Promise(resolve=>finish=resolve),changed(){}});
 await tick();assert.equal(row.state,'checking');finish();await done;assert.equal(row.state,'saved');
});
test('abort retains pending selection and does not begin the next transfer',async()=>{
 const rows=[item('a'),item('b')],controller=new AbortController();const sent=[];
 await assert.rejects(sendPhotos(rows,controller.signal,{prepare:async()=>prepared(),transfer:async row=>{sent.push(row.id);controller.abort();throw controller.signal.reason;},changed(){}}),{name:'AbortError'});
 assert.deepEqual(sent,['a']);assert.ok(rows.every(row=>row.state==='waiting'));assert.equal(rows.length,2);
});
test('lost reservation/PUT/completion responses retry immutable bytes and keys without another album page',async()=>{
 const original=globalThis.fetch;globalThis.window={location:{origin:'http://localhost'}};
 const row={...item('client-file'),prepared:prepared()},calls=[],reservations=[],uploads=[];let reservationLost=true,completeLost=true,putLost=true,accepted=false;
 const response=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(url,options)=>{
  calls.push(url);
  if(url==='/api/v1/albums/a')return response({detail:{album:{version:1}}});
  if(url==='/api/v1/albums/a/uploads'){
   reservations.push(options);
   if(reservationLost){reservationLost=false;throw new TypeError('lost reply');}
   return response({uploads:[{page_id:'p',upload_id:'u',upload_url:'/api/v1/private/uploads/u',required_headers:{'Content-Type':'image/webp'}}]});
  }
  if(url==='/api/v1/private/uploads/u'){uploads.push(options.body);if(putLost){putLost=false;throw new TypeError('lost put');}return new Response(null,{status:204});}
  if(url.endsWith('/complete')){accepted=true;if(completeLost){completeLost=false;throw new TypeError('lost ack');}return response({status:'validating'});}
  return response({status:accepted?'ready':'reserved'});
 };
 try{
  await transferPhoto('a',row,new AbortController().signal,()=>{});await verifyPhoto('a',row,new AbortController().signal);
  assert.equal(reservations.length,2);assert.equal(reservations[0].body,reservations[1].body);assert.equal(reservations[0].headers['Idempotency-Key'],reservations[1].headers['Idempotency-Key']);
  assert.equal(row.pageId,'p');assert.equal(row.transferred,true);assert.ok(uploads.every(file=>file===row.prepared.file));assert.equal(calls.filter(path=>path==='/api/v1/albums/a').length,1);
 }finally{globalThis.fetch=original;}
});
test('permission denial is not retried',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'ACCESS_APPROVAL_REQUIRED'}}),{status:403});};
 try{await assert.rejects(transferPhoto('a',{...item('a'),prepared:prepared()},new AbortController().signal,()=>{}));assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test.after(()=>rm(dir,{recursive:true,force:true}));
