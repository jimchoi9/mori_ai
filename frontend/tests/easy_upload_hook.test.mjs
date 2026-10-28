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
function harness(album='a',known=[],user='u'){
 const cells=[],cleanups=[];let cursor=0,initial=true;
 const hooks={state(value){const index=cursor++;if(!(index in cells))cells[index]=value;return [cells[index],next=>cells[index]=typeof next==='function'?next(cells[index]):next];},ref(value){const index=cursor++;return cells[index]??={current:value};},effect(work){if(initial)cleanups.push(work());}};
 return {render(){globalThis.hooks=hooks;cursor=0;const result=useEasyUploads(album,user,async()=>{},20,known);initial=false;return result;},close(){cleanups.forEach(f=>f());}};
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
test('online recovery resumes a failed send without sending newly attached photos',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const h=harness('consent');let hook=h.render();hook.select([photo(1)],20);hook=h.render();
 const prepared=[],transferred=[];let failed=false;
 globalThis.fetch=async()=>response({detail:{pages:[]}});
 globalThis.prepare=async(file)=>{prepared.push(file.name);if(!failed){failed=true;throw Error('temporary');}return {file};};
 globalThis.transfer=async(_album,item)=>{transferred.push(item.file.name);item.pageId='p1';item.transferred=true;};globalThis.verify=async()=>{};
 await hook.send();hook=h.render();hook.select([photo(2)],19);hook=h.render();
 window.dispatchEvent(new Event('online'));
 for(let i=0;i<50&&h.render().items[0].state!=='saved';i++)await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(h.render().items[0].state,'saved');assert.deepEqual(prepared,['1.jpg','1.jpg']);assert.deepEqual(transferred,['1.jpg']);
 const attached=h.render().items.find(item=>item.file.name==='2.jpg');assert.equal(attached.state,'selected');assert.equal(attached.submitted,undefined);h.close();
});
test('an explicit send of a new attachment does not retry an unrelated failed message',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const h=harness('target');let hook=h.render();hook.select([photo(1)],20);hook=h.render();
 const prepared=[];globalThis.fetch=async()=>response({detail:{pages:[]}});
 globalThis.prepare=async file=>{prepared.push(file.name);if(file.name==='1.jpg')throw Error('cannot decode');return {file};};
 globalThis.transfer=async(_album,item)=>{item.pageId='p2';item.transferred=true;};globalThis.verify=async()=>{};
 await hook.send();hook=h.render();const firstBatch=hook.items[0].batchId;hook.select([photo(2)],19);hook=h.render();
 await hook.send([hook.items[1].id]);hook=h.render();
 assert.deepEqual(prepared,['1.jpg','2.jpg']);assert.equal(hook.items[0].state,'failed');assert.equal(hook.items[0].batchId,firstBatch);
 assert.equal(hook.items[1].state,'saved');assert.notEqual(hook.items[1].batchId,firstBatch);h.close();
});
test('batch page references survive acknowledged file cleanup without retaining private files',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const known=[],h=harness('groups',known);let hook=h.render();hook.select([photo(1)],20);hook=h.render();
 globalThis.fetch=async()=>response({detail:{pages:[]}});globalThis.prepare=async file=>({file});
 globalThis.transfer=async(_album,item)=>{item.pageId='p'+item.file.name[0];item.transferred=true;};globalThis.verify=async()=>{};
 await hook.send();known.push('p1');hook=h.render();const first=hook.batches[0].id;hook.select([photo(2)],19);hook=h.render();
 assert.equal(hook.items.length,1);assert.deepEqual(hook.batches[0].photos.map(ref=>ref.pageId),['p1']);
 assert.equal(JSON.stringify(hook.batches).includes('original'),false);
 await hook.send();hook=h.render();assert.equal(hook.batches.length,2);assert.equal(hook.batches[0].id,first);
 window.dispatchEvent(new Event('mori:clear-private-memory'));assert.deepEqual(h.render().batches,[]);h.close();
});
test('another account cannot receive the tab draft or its message metadata',()=>{
 window.dispatchEvent(new Event('mori:logout'));const a=harness('same',[],'a'),b=harness('same',[],'b');
 a.render().select([photo(1)],20);assert.equal(a.render().items.length,1);assert.equal(b.render().items.length,0);assert.deepEqual(b.render().batches,[]);a.close();b.close();
});
test('replacement preserves its target and is admitted at an already full 20-photo album',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const known=Array.from({length:20},(_,i)=>'p'+i),h=harness('replace-full',known);let hook=h.render();
 globalThis.fetch=async()=>response({detail:{pages:known.map(id=>({id}))}});globalThis.prepare=async file=>({file});const sent=[];
 globalThis.transfer=async(_album,item)=>{sent.push(item.replacesPageId);item.pageId='replacement';item.transferred=true;};globalThis.verify=async()=>{};
 await hook.replace(photo(1),'p0');hook=h.render();assert.deepEqual(sent,['p0']);assert.equal(hook.items[0].state,'saved');assert.equal(hook.items[0].replacesPageId,'p0');h.close();
});
test('cancelling a replacement with a lost confirmation never deletes an already ready new photo',async()=>{
 window.dispatchEvent(new Event('mori:logout'));const h=harness('replace-confirmation');let hook=h.render(),visible=false,deletes=0;
 globalThis.fetch=async(_url,options)=>{if(options?.method==='DELETE')deletes++;return response({detail:{pages:visible?[{id:'new-photo',upload_status:'ready'}]:[{id:'old-photo',upload_status:'ready'}]}});};
 globalThis.prepare=async file=>({file});globalThis.transfer=async(_album,item)=>{item.pageId='new-photo';item.transferred=true;};globalThis.verify=async()=>{throw Error('confirmation interrupted');};
 await hook.replace(photo(1),'old-photo');hook=h.render();assert.equal(hook.items[0].state,'failed');visible=true;
 await hook.remove(hook.items[0]);assert.equal(h.render().items[0].state,'saved');assert.equal(deletes,0);h.close();
});
test.after(()=>rm(dir,{recursive:true,force:true}));
