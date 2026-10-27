import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/preloadMemories.ts'],bundle:true,platform:'node',format:'esm',outfile:'nfc-loading-check.mjs'});
const {preloadMemories}=await import('../nfc-loading-check.mjs');
const id=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const path=n=>'/api/v1/nfc/media/'+id(n);
const tick=()=>new Promise(r=>setTimeout(r,0));
function harness(count){
 const pending=new Map(),calls=[],blobs=new Map(),progress=[];let ready=false,number=0;
 globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>{pending.set(url,{resolve,reject});options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
 const data={session_token:'session',music_url:'/api/v1/nfc/music',pages:Array.from({length:count},(_,i)=>({id:id(i),text:`memory ${i}`,src:path(100+i),thumb:path(200+i)}))};
 const controller=new AbortController();
 const result=preloadMemories(data,controller.signal,blob=>{const url=`blob:test-${++number}`;blobs.set(url,blob);return url;},(slot,src)=>calls.push({slot,src}),(loaded,total)=>progress.push({loaded,total})).then(book=>{ready=true;return book;});
 return {data,pending,calls,blobs,progress,result,controller,get ready(){return ready;},async finish(url,status=200){const response=pending.get(url);assert.ok(response,`request ${url} exists`);pending.delete(url);response.resolve(new Response(url,{status}));await tick();}};
}
test('small completed previews appear while full pages are still downloading; opening waits for all pages and music',async()=>{
 const original=globalThis.fetch;const h=harness(3);
 try{
  assert.deepEqual([...h.pending.keys()].slice(0,3),h.data.pages.map(p=>p.thumb));
  await h.finish(h.data.pages[0].thumb);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].slot,0);assert.equal(h.ready,false);
  assert.equal(await h.blobs.get(h.calls[0].src).text(),h.data.pages[0].thumb);
  for(const p of h.data.pages)await h.finish(p.src);
  assert.equal(h.ready,false,'BGM is still downloading');
  await h.finish(h.data.music_url);const book=await h.result;
  assert.equal(h.ready,true);assert.equal(book.pages.length,3);assert.deepEqual(h.progress.at(-1),{loaded:3,total:3});
  for(const p of h.data.pages.slice(1))await h.finish(p.thumb);
 }finally{h.controller.abort();globalThis.fetch=original;}
});
test('every eighth completed page replaces a memory tile, and a late initial thumbnail cannot overwrite it',async()=>{
 const original=globalThis.fetch;const h=harness(9);
 try{
  await h.finish(h.data.pages[0].thumb);
  for(let i=0;i<8;i++)await h.finish(h.data.pages[i].src);
  const atEight=h.calls.at(-1);assert.equal(atEight.slot,1);
  assert.equal(await h.blobs.get(atEight.src).text(),h.data.pages[7].src);
  const count=h.calls.length;await h.finish(h.data.pages[1].thumb);assert.equal(h.calls.length,count);
  assert.equal(h.ready,false);
  await h.finish(h.data.pages[8].src);await h.finish(h.data.music_url);await h.result;
  for(const p of h.data.pages.slice(2,4))await h.finish(p.thumb);
 }finally{h.controller.abort();globalThis.fetch=original;}
});
test('an optional thumbnail failure does not block the album and falls back to a completed full photo',async()=>{
 const original=globalThis.fetch;const h=harness(1);
 try{
  await h.finish(h.data.pages[0].thumb,404);await h.finish(h.data.pages[0].src);await h.finish(h.data.music_url);
  await h.result;assert.equal(h.calls.length,1);assert.equal(await h.blobs.get(h.calls[0].src).text(),h.data.pages[0].src);
 }finally{h.controller.abort();globalThis.fetch=original;}
});
test.after(()=>unlink('nfc-loading-check.mjs'));
