import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/NfcExperience.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'nfc-revisit-check.mjs',plugins:[{name:'reader-test',setup(b){
 b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'mock'}));
 b.onResolve({filter:/\/api$|^\.\/api$|^api$/},a=>({path:'api',namespace:'mock'}));
 b.onResolve({filter:/\.\/entry$|\.\/preloadMemories$|\.\/LoadingScene$|\.\/MemoryBook$/},a=>({path:a.path,namespace:'mock'}));
 b.onResolve({filter:/\.css$/},()=>({path:'style',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react'?`export const useRef=v=>h.ref(v),useState=v=>h.state(v),useEffect=(f,d)=>h.effect(f,d);`:a.path==='api'?`export class NfcSessionExpired extends Error{};export const enter=(...a)=>env.enter(...a),close=t=>env.close(t),readerLibrary=()=>Promise.resolve();`:a.path==='./entry'?`export const captureEntry=()=>env.entry,retainEntry=e=>env.retained.push(e),rememberEntry=e=>env.remembered.push(e);`:a.path==='./preloadMemories'?`import {NfcSessionExpired} from 'api';export const preloadMemories=(...a)=>{if(env.expired-->0)throw new NfcSessionExpired('expired');return env.preload(...a);};`:a.path==='./LoadingScene'?`export const LoadingScene='loading';`:a.path==='./MemoryBook'?`export const MemoryBook='book';`:'',loader:'js'}));
}}]});
const {NfcExperience}=await import('../nfc-revisit-check.mjs');
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function setup(){
 const original={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,Image:globalThis.Image};
 const timers=new Map();let timerId=0,index=0,dirty=false,tree;const cells=[],effects=[],cleanups=[];
 globalThis.setTimeout=(f,delay)=>{timers.set(++timerId,{f,delay});return timerId;};globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.document={title:'Mori',body:{classList:{add(){},remove(){}}},documentElement:{dataset:{}},getElementById:()=>null,querySelector:()=>null};
 globalThis.window=new EventTarget();globalThis.addEventListener=window.addEventListener.bind(window);globalThis.removeEventListener=window.removeEventListener.bind(window);
 globalThis.Image=class{dataset={};decode(){return Promise.resolve();}};
 const closed=[],enters=[],retained=[],remembered=[];
 globalThis.env={entry:{id:'11111111-1111-4111-8111-111111111111',key:'k'.repeat(43)},expired:0,retained,remembered,close:t=>{closed.push(t);return Promise.resolve();},
  enter:async(e,signal)=>{enters.push({e,signal});return {state:'ready',session_token:'session-'+enters.length,expires_at:new Date(0).toISOString(),pages:[{id:'p',text:'new',src:'/media'}]};},
  preload:async()=>({pages:[{text:'new',src:'blob:photo'}],music:null})};
 globalThis.h={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],n=>{cells[i]=typeof n==='function'?n(cells[i]):n;dirty=true;}];},effect(f,deps){const i=index++,old=cells[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){cells[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=f();});}}};
 function render(){index=0;dirty=false;tree=NfcExperience();while(effects.length)effects.shift()();}
 async function settle(){for(let i=0;i<30;i++){await Promise.resolve();if(dirty)render();}}
 render();return {enters,closed,retained,remembered,timers,settle,get tree(){return tree;},cleanup(){for(const f of cleanups)f?.();Object.assign(globalThis,original);}};
}
test('an expired transfer timestamp never closes an already loaded book or forces a new tag',async()=>{
 const h=setup();try{await h.settle();assert.ok(nodes(h.tree).some(n=>n.type==='book'));assert.equal(h.enters.length,1);assert.equal(h.remembered.length,1);assert.equal(h.retained.length,1);
  assert.deepEqual([...h.timers.values()].map(t=>t.delay),[900]);for(const t of [...h.timers.values()])t.f();await h.settle();assert.ok(nodes(h.tree).some(n=>n.type==='book'));assert.equal(h.closed.length,0);assert.equal(nodes(h.tree).some(n=>n.type==='button'),false);
 }finally{h.cleanup();}
});
test('pagehide releases the transfer and bfcache return automatically reopens the saved entry',async()=>{
 const h=setup();try{await h.settle();window.dispatchEvent(new Event('pagehide'));await h.settle();assert.ok(h.closed.includes('session-1'));
  const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);await h.settle();assert.equal(h.enters.length,2);assert.ok(nodes(h.tree).some(n=>n.type==='book'));
 }finally{h.cleanup();}
});
test('returning to the book reuses the existing entry and expired transfer automatically retries once',async()=>{
 const h=setup();try{await h.settle();env.expired=1;window.dispatchEvent(new Event('pagehide'));const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);await h.settle();assert.equal(h.enters.length,3);assert.ok(nodes(h.tree).some(n=>n.type==='book'));assert.deepEqual(h.enters[2].e,env.entry);
 }finally{h.cleanup();}
});
test('repeated transfer expiry stops retrying and manual reload recovers without another tag',async()=>{
 const h=setup();try{await h.settle();env.expired=5;window.dispatchEvent(new Event('pagehide'));const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});window.dispatchEvent(event);await h.settle();assert.equal(h.enters.length,3);assert.equal(nodes(h.tree).some(n=>n.type==='book'),false);
  env.expired=0;nodes(h.tree).find(n=>n.type==='button'&&n.props.children==='다시 불러오기').props.onClick();await h.settle();assert.equal(h.enters.length,4);assert.ok(nodes(h.tree).some(n=>n.type==='book'));
 }finally{h.cleanup();}
});
test.after(()=>unlink('nfc-revisit-check.mjs'));
