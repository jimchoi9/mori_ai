import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'easy-hook-'));
globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.hidden=false;
await build({entryPoints:['src/features/uploads/useEasyUploads.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'hook.mjs'),plugins:[{name:'harness',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'stub'}));
 b.onResolve({filter:/\.\/optimizePhoto$/},()=>({path:'optimize',namespace:'stub'}));
 b.onResolve({filter:/\.\/easyTransport$/},()=>({path:'transport',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},({path})=>({loader:'js',contents:path==='react'?`export const useState=v=>globalThis.hooks.state(v),useRef=v=>globalThis.hooks.ref(v),useEffect=f=>globalThis.hooks.effect(f);`:path==='optimize'?`export const optimizePhoto=(...args)=>globalThis.prepare(...args);`:`export const transferPhoto=(...args)=>globalThis.transfer(...args),verifyPhoto=(...args)=>globalThis.verify(...args);`}));
}}]});
const {useEasyUploads}=await import(join(dir,'hook.mjs'));
function harness(album='a',known=[]){
 const cells=[],cleanups=[];let cursor=0,initial=true;
 globalThis.hooks={state(value){const index=cursor++;if(!(index in cells))cells[index]=value;return [cells[index],next=>cells[index]=typeof next==='function'?next(cells[index]):next];},ref(value){const index=cursor++;return cells[index]??={current:value};},effect(work){if(initial)cleanups.push(work());}};
 return {render(){cursor=0;const result=useEasyUploads(album,'u',async()=>{},20,known);initial=false;return result;},close(){cleanups.forEach(f=>f());}};
}
const photo=i=>new File(['original'],`${i}.jpg`,{type:'image/jpeg'});
const response=data=>new Response(JSON.stringify({data}));
test('over-limit selection is retained and sending cannot silently choose the first 20',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const h=harness('over');let hook=h.render();hook.select(Array.from({length:21},(_,i)=>photo(i)),20);hook=h.render();
 assert.equal(hook.items.length,21);assert.match(hook.error,/1장 초과/);let prepared=0;
 globalThis.prepare=async()=>{prepared++;};globalThis.fetch=async()=>response({detail:{pages:[]}});
 await hook.send();hook=h.render();assert.equal(prepared,0);assert.equal(hook.items.length,21);assert.match(hook.error,/20장/);
 await hook.remove(hook.items[20]);assert.equal(h.render().items.length,20);h.close();
});
test('logout aborts local preparation before any reservation and clears all private files',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const h=harness('privacy');let hook=h.render();hook.select([photo(1)],20);hook=h.render();let started=false;
 globalThis.fetch=async()=>response({detail:{pages:[]}});
 globalThis.prepare=(_file,signal)=>new Promise((_resolve,reject)=>{started=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 globalThis.transfer=async()=>{throw Error('must not upload');};globalThis.verify=async()=>{};
 const pending=hook.send();while(!started)await new Promise(resolve=>setTimeout(resolve,0));window.dispatchEvent(new Event('mori:clear-private-memory'));await pending;
 assert.equal(h.render().items.length,0);assert.equal(h.render().busy,false);h.close();
});
test('a confirmed photo is retained until the gallery acknowledges it, even when another selection is added',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const h=harness('delayed-gallery');let hook=h.render();hook.select([photo(1)],20);hook=h.render();
 globalThis.fetch=async()=>response({detail:{pages:[]}});globalThis.prepare=async()=>({file:photo(1)});
 globalThis.transfer=async(_album,item)=>{item.pageId='saved-page';item.transferred=true;};globalThis.verify=async()=>{};
 await hook.send();hook=h.render();assert.equal(hook.items[0].state,'saved');hook.select([photo(2)],19);
 assert.equal(h.render().items.length,2);assert.equal(h.render().items[0].pageId,'saved-page');h.close();
});
test('the next selection releases saved draft files after the server gallery acknowledges them',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const known=[],h=harness('acknowledged-gallery',known);let hook=h.render();hook.select([photo(1)],20);hook=h.render();
 globalThis.fetch=async()=>response({detail:{pages:[]}});globalThis.prepare=async()=>({file:photo(1)});
 globalThis.transfer=async(_album,item)=>{item.pageId='saved-page';item.transferred=true;};globalThis.verify=async()=>{};
 await hook.send();known.push('saved-page');hook=h.render();hook.select([photo(2)],19);
 assert.equal(h.render().items.length,1);assert.equal(h.render().items[0].file.name,'2.jpg');h.close();
});
test.after(()=>rm(dir,{recursive:true,force:true}));
