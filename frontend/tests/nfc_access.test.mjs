import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/api.ts'],bundle:true,platform:'node',format:'esm',outfile:'nfc-access-check.mjs'});
const nfc=await import('../nfc-access-check.mjs');
const id='11111111-1111-4111-8111-111111111111',secret='k'.repeat(43);
test('entry reads only a tag path and fragment, then replaces it with a non-capability viewer address',()=>{
 globalThis.location={pathname:`/nfc/${id}`,hash:`#key=${secret}`};
 let replaced;globalThis.history={state:null,replaceState:(_s,_t,url)=>replaced=url};
 assert.deepEqual(nfc.captureEntry(),{id,key:secret});nfc.clearEntry();assert.equal(replaced,'/nfc/view');
 location={pathname:'/nfc/view',hash:''};assert.equal(nfc.captureEntry(),null);
 location={pathname:`/nfc/${id}`,hash:'#key=too-short'};assert.equal(nfc.captureEntry(),null);
});
test('tag exchange never sends the account cookie and does not put secrets in URLs',async()=>{
 const original=globalThis.fetch;let seen;
 globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(JSON.stringify({data:{state:'preparing'}}));};
 try{assert.deepEqual(await nfc.enter({id,key:secret},new AbortController().signal),{state:'preparing'});
  assert.equal(seen.url,`/api/v1/nfc/tags/${id}/enter`);assert.equal(seen.options.credentials,'omit');
  assert.equal(seen.options.cache,'no-store');assert.equal(JSON.parse(seen.options.body).token,secret);
 }finally{globalThis.fetch=original;}
});
test('media sends only the tab capability to the dedicated NFC media API',async()=>{
 const original=globalThis.fetch;let seen;
 globalThis.fetch=async(url,options)=>{seen={url,options};return new Response('photo');};
 try{assert.equal((await nfc.download(`/api/v1/nfc/media/${id}`,'session',new AbortController().signal)).size,5);
  assert.deepEqual(seen.options.headers,{'X-Mori-Viewer-Token':'session'});assert.equal(seen.options.credentials,'omit');
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
  await assert.rejects(nfc.download('https://elsewhere.test/photo','session',new AbortController().signal));assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('expiry feedback asks for a new tag and close does not mutate login cookies',async()=>{
 const original=globalThis.fetch;let seen;
 globalThis.fetch=async()=>new Response('',{status:401});
 try{await assert.rejects(nfc.download(`/api/v1/nfc/media/${id}`,'session',new AbortController().signal),/다시 태그/);
  globalThis.fetch=async(url,options)=>{seen={url,options};return new Response(null,{status:204});};
  await nfc.close(secret);assert.equal(seen.url,'/api/v1/nfc/close');assert.equal(seen.options.credentials,'omit');assert.equal(seen.options.keepalive,true);
 }finally{globalThis.fetch=original;}
});
test.after(()=>unlink('nfc-access-check.mjs'));
