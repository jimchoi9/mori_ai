import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'caption-delete-cleanup-'));
globalThis.window=new EventTarget();window.setTimeout=(...args)=>setTimeout(...args);
await build({entryPoints:['src/features/content/useCaptionEdits.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'caption.mjs'),plugins:[{name:'hooks',setup(b){
 b.onResolve({filter:/^react$|useUnsavedGuard$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react'?`export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d);`:`export const useUnsavedGuard=dirty=>hooks.effect(()=>{events.push({guard:dirty});},[dirty]);`}));
}}]});
const {useCaptionEdits}=await import(join(dir,'caption.mjs'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const cells=[],pending=[],cleanups=new Map();let cursor=0,changed=false;
 const page={id:'p',version:1,caption_text:'저장된 글귀'},pages=[page];globalThis.events=[];
 globalThis.hooks={ref:value=>{const i=cursor++;return cells[i]??={current:value};},state:value=>{const i=cursor++;if(!(i in cells))cells[i]=value;return [cells[i],next=>{const value=typeof next==='function'?next(cells[i]):next;if(value!==cells[i]){cells[i]=value;changed=true;}}];},effect:(work,deps)=>{const i=cursor++,old=cells[i];if(!old||deps.some((value,n)=>value!==old[n])){cells[i]=deps;pending.push([i,work]);}}};
 return {paused:false,render(){let result;for(let pass=0;pass<8;pass++){cursor=0;changed=false;result=useCaptionEdits('album',pages,async()=>{},this.paused);for(const [i,work] of pending.splice(0)){cleanups.get(i)?.();cleanups.set(i,work());}if(!changed)return result;}throw Error('Hook did not settle');},close(){for(const cleanup of cleanups.values())cleanup?.();}};
}
test('delete review pauses autosave, cancellation resumes the same pending caption',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});const calls=[];globalThis.fetch=async(url,options)=>{calls.push(options.method);return new Response(JSON.stringify({data:{page:{id:'p',version:2,caption_text:'새 글귀'}}}));};
 const h=setup();h.render().change('p','새 글귀');h.paused=true;h.render();context.mock.timers.tick(1000);await tick();assert.deepEqual(calls,[]);assert.equal(h.render().drafts.p.text,'새 글귀');
 h.paused=false;h.render();context.mock.timers.tick(801);await tick();h.render();assert.deepEqual(calls,['PATCH']);assert.equal(h.render().dirty,false);h.close();
});
test('confirmed deletion clears captions and resolves only after the navigation guard is disabled',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not save deleted album');};
 const h=setup();h.render().change('p','미저장 글귀');h.paused=true;let hook=h.render();assert.equal(hook.dirty,true);
 let settled=false;const discarded=hook.discard().then(()=>settled=true);await tick();assert.equal(settled,false);
 hook=h.render();await discarded;assert.equal(events.at(-1).guard,false);assert.equal(hook.dirty,false);assert.deepEqual(hook.drafts,{});
 context.mock.timers.tick(2000);await tick();assert.equal(calls,0);hook.change('p','늦은 이벤트');assert.deepEqual(h.render().drafts,{});h.close();
});
test.after(()=>rm(dir,{recursive:true,force:true}));
