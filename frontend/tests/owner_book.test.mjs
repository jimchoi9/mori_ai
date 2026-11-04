import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'owner-book-'));
await build({entryPoints:['src/features/nfc/ownerSource.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'source.mjs'),plugins:[{name:'api',setup(b){b.onResolve({filter:/api\/client$/},()=>({path:'api',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const api=(...a)=>env.api(...a);'}));}}]});
const {ownerSource}=await import(join(dir,'source.mjs'));
function setup(){
 const original={fetch:globalThis.fetch,location:globalThis.location};globalThis.location={origin:'https://app.test'};
 const requests=[],signs=[];let version=0;
 globalThis.env={api:async(path,options)=>{requests.push({path,options});if(path.endsWith('/viewer'))return {title:'나의 추억',pages:[{id:'p',caption_text:'직접 쓴 글',image:{asset_id:'image'},thumbnail:{asset_id:'thumb'}}],media_access:[],music:{url:'/audio/bgm.mp3'}};
  signs.push(options.body.asset_ids);version++;return {media_access:['image','thumb'].map(id=>({asset_id:id,url:`https://app.test/private/${id}?v=${version}`,expires_at:'2099-01-01T00:00:00Z'}))};}};
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});return new Response('image');};
 return {requests,signs,close(){Object.assign(globalThis,original);}};
}
test('owner book uses existing authenticated viewer and signed media, with no tag key or public session',async()=>{
 const h=setup();try{const source=ownerSource('album'),signal=new AbortController().signal,book=await source.open(signal);
 assert.equal(book.album_title,'나의 추억');assert.deepEqual(book.pages,[{id:'p',text:'직접 쓴 글',src:'image',thumb:'thumb'}]);assert.equal(book.session_token,undefined);assert.equal(source.private,true);
 assert.deepEqual(h.signs,[['image','thumb']]);await source.read('image',signal);assert.equal(h.requests.at(-1).options.credentials,'same-origin');
 await source.read('/audio/bgm.mp3',signal);assert.equal(h.requests.at(-1).url,'/audio/bgm.mp3');
 assert.equal(h.requests.some(r=>/nfc|tags/.test(r.path??r.url)),false);
 await assert.rejects(source.read('foreign',signal),/감상 자료/);source.close();await assert.rejects(source.read('image',signal),/감상 자료/);
 }finally{h.close();}
});
test('expired signed media renews once and parallel failures share the renewal',async()=>{
 const h=setup();try{const source=ownerSource('album'),signal=new AbortController().signal;await source.open(signal);let failures=0;
 globalThis.fetch=async(url,options)=>{h.requests.push({url:String(url),options});if(String(url).includes('v=1')){failures++;return new Response('',{status:403});}return new Response('renewed');};
 const results=await Promise.all([source.read('image',signal),source.read('thumb',signal)]);assert.equal(failures,2);assert.equal(h.signs.length,2);assert.deepEqual(await Promise.all(results.map(r=>r.text())),['renewed','renewed']);
 }finally{h.close();}
});
test('cross-origin signed URLs omit login cookies; arbitrary protocols and missing assets are rejected',async()=>{
 const h=setup();try{const source=ownerSource('album'),signal=new AbortController().signal;
 const original=env.api;env.api=async(...a)=>{const data=await original(...a);if(data.media_access)data.media_access=data.media_access.map(item=>({...item,url:item.asset_id==='image'?'https://cdn.test/object':'javascript:alert(1)'}));return data;};
 await source.open(signal);await source.read('image',signal);assert.equal(h.requests.at(-1).options.credentials,'omit');const count=h.requests.length;await assert.rejects(source.read('thumb',signal),/사진 주소/);assert.equal(h.requests.length,count);
 }finally{h.close();}
});
test('a late signing response after abort never revives a private book',async()=>{
 const h=setup();try{let resolve;env.api=async path=>path.endsWith('/viewer')?{title:'추억',pages:[{id:'p',caption_text:'글',image:{asset_id:'image'}}],media_access:[],music:null}:new Promise(r=>resolve=r);
 const source=ownerSource('album'),controller=new AbortController(),opening=source.open(controller.signal);await Promise.resolve();controller.abort();source.close();resolve({media_access:[{asset_id:'image',url:'/private',expires_at:'2099-01-01T00:00:00Z'}]});await assert.rejects(opening,{name:'AbortError'});await assert.rejects(source.read('image',new AbortController().signal));
 }finally{h.close();}
});
test.after(()=>rm(dir,{recursive:true,force:true}));
