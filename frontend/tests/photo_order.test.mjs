import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'photo-order-'));
for(const file of ['order','hold','usePhotoOrder'])await build({entryPoints:[`src/features/content/reorder/${file}.ts`],bundle:true,platform:'node',format:'esm',outfile:join(dir,file+'.mjs'),plugins:[{name:'hook-harness',setup(b){
 b.onResolve({filter:/^react$|^@tanstack\/react-query$|api\/client$|usePrivateRequest$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react'?`export const useRef=v=>h.ref(v),useState=v=>h.state(v),useEffect=(f,d)=>h.effect(f,d);`:a.path==='@tanstack/react-query'?`export const useQueryClient=()=>env.cache;`:/usePrivateRequest$/.test(a.path)?`export const usePrivateRequest=()=>env.request;`:`export const api=(...args)=>env.api(...args),errorText=e=>e.message;`}));
}}]});
const {placeBefore,projected,sameOrder,insertionSlot}=await import(join(dir,'order.mjs'));
const {createHold,HOLD_MS}=await import(join(dir,'hold.mjs'));
const {usePhotoOrder}=await import(join(dir,'usePhotoOrder.mjs'));
function timers(){const original={setTimeout,clearTimeout};let now=0,serial=0;const tasks=new Map();globalThis.setTimeout=(f,delay)=>{tasks.set(++serial,{f,at:now+delay});return serial;};globalThis.clearTimeout=id=>tasks.delete(id);return {advance(ms){now+=ms;for(const [id,t] of [...tasks])if(t.at<=now){tasks.delete(id);t.f();}},restore(){Object.assign(globalThis,original);}};}
test('300ms hold queues during saving, resumes once, and cancellation never revives',()=>{
 const clock=timers();try{assert.equal(HOLD_MS,300);let blocked=true,count=0;const hold=createHold(()=>blocked,()=>count++);clock.advance(299);blocked=false;hold.resume();assert.equal(count,0);blocked=true;clock.advance(1);assert.equal(count,0);blocked=false;hold.resume();hold.resume();assert.equal(count,1);
 const cancelled=createHold(()=>blocked,()=>count++);clock.advance(300);assert.equal(count,2);cancelled.cancel();cancelled.resume();assert.equal(count,2);
 blocked=true;const released=createHold(()=>blocked,()=>count++);clock.advance(300);released.cancel();blocked=false;released.resume();assert.equal(count,2);
 const short=createHold(()=>false,()=>count++);clock.advance(200);short.cancel();clock.advance(300);assert.equal(count,2);
 }finally{clock.restore();}
});
test('all source and insertion slots preserve the other photos, including the first and last',()=>{
 for(let count=1;count<=50;count++){const ids=Array.from({length:count},(_,i)=>'p'+i);for(const id of ids){const rest=ids.filter(p=>p!==id);for(let slot=0;slot<count;slot++){const next=placeBefore(ids,id,rest[slot]??null);assert.equal(next[slot],id);assert.equal(new Set(next).size,count);assert.deepEqual(next.filter(p=>p!==id),rest);}}}
 assert.equal(placeBefore(['a','b'],'a','lost'),null);assert.equal(placeBefore(['a','b'],'lost',null),null);assert.equal(placeBefore(['a','b'],'a','a'),null);
 assert.equal(insertionSlot([50,150,250],0),0);assert.equal(insertionSlot([50,150,250],160),2);assert.equal(insertionSlot([50,150,250],999),3);
});
test('projection uses current caption objects and keeps newly added photos without reviving deleted ones',()=>{
 const pages=[{id:'a',caption:'latest'},{id:'c'},{id:'new'}];const result=projected(pages,['c','gone','a']);assert.deepEqual(result.map(p=>p.id),['c','a','new']);assert.equal(result[1],pages[0]);assert.equal(projected(pages,null),pages);
});
const detail=(ids=['a','b','c'],version=7,mode='manual')=>({detail:{album:{id:'album',version},order_mode:mode,pages:ids.map(id=>({id,caption_text:'caption '+id}))},media_access:[{asset_id:'fresh-url'}]});
function setup(){
 let data=detail(),index=0,dirty=false,hook;const cells=[],effects=[],cleanups=[],events=[];
 const clock=timers();const activity={current:{gesture:false,writing:false}},request={current:new AbortController()};
 globalThis.env={request,cache:{cancelQueries:async()=>events.push('cancel-query'),setQueryData:(_key,value)=>{data=value;dirty=true;},invalidateQueries:async()=>events.push('invalidate')},api:async(path,opts={})=>{events.push({path,...opts});return opts.method==='PUT'?detail(opts.body.page_ids,8):detail();}};
 let saved=0,failed=0;const options={albumId:'album',userId:'owner',activity,allow:()=>true,flush:async()=>{events.push('flush');return true;},saved:()=>saved++,failed:()=>failed++};
 globalThis.h={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],n=>{cells[i]=typeof n==='function'?n(cells[i]):n;dirty=true;}];},effect(f,deps){const i=index++,old=cells[i];if(!old||deps.some((v,j)=>!Object.is(v,old[j]))){cells[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=f();});}}};
 function render(){index=0;dirty=false;hook=usePhotoOrder({...options,pages:data.detail.pages});while(effects.length)effects.shift()();return hook;}
 async function settle(){for(let i=0;i<30;i++){await Promise.resolve();if(dirty)render();}}
 render();return {options,activity,request,events,render,settle,get hook(){return hook;},get data(){return data;},get saved(){return saved;},get failed(){return failed;},close(){for(const f of cleanups)f?.();clock.restore();}};
}
test('drop flushes captions and uses fresh version and stable neighbour while preserving concurrent additions',async()=>{
 const t=setup();try{env.api=async(path,opts={})=>{t.events.push({path,...opts});return opts.method==='PUT'?{...detail(opts.body.page_ids,10),media_access:[]}:detail(['a','new','b','c'],9);};
 const pending=t.hook.move('a','c');assert.equal(t.activity.current.writing,true);t.render();assert.deepEqual(t.hook.pages.map(p=>p.id),['b','a','c']);assert.equal(await pending,true);await t.settle();
 assert.deepEqual(t.events.slice(0,2),['flush','cancel-query']);const put=t.events.find(e=>e.method==='PUT');assert.deepEqual(put.body,{expected_version:9,page_ids:['new','b','a','c']});assert.deepEqual(t.data.media_access,[{asset_id:'fresh-url'}]);assert.equal(t.saved,1);assert.equal(t.activity.current.writing,false);assert.equal(t.hook.busy,false);
 }finally{t.close();}
});
test('an acknowledgement keeps the accepted display order and suppresses the toast during the next hold',async()=>{
 const t=setup();try{let release;t.options.flush=()=>new Promise(r=>release=r);t.render();const p=t.hook.move('a',null);t.activity.current.gesture=true;release(true);await p;await t.settle();assert.deepEqual(t.hook.pages.map(p=>p.id),['b','c','a']);assert.equal(t.hook.message,'');assert.equal(t.saved,1);
 }finally{t.close();}
});
test('serializes saves and blocks a mutation after failed caption flush or lost neighbour',async()=>{
 const t=setup();try{let release;t.options.flush=()=>new Promise(r=>release=r);t.render();const first=t.hook.move('a',null);assert.equal(await t.hook.move('b',null),false);release(false);assert.equal(await first,false);await t.settle();assert.equal(t.events.filter(e=>e.method==='PUT').length,0);assert.match(t.hook.error,/글귀/);
 t.options.flush=async()=>true;env.api=async()=>detail(['a','b']);t.render();assert.equal(await t.hook.move('a','c'),false);await t.settle();assert.match(t.hook.error,/목록이 바뀌/);assert.equal(t.failed,2);
 }finally{t.close();}
});
test('a lost PUT response is confirmed by GET without a duplicate write',async()=>{
 const t=setup();try{let puts=0,reads=0;env.api=async(_path,opts={})=>{if(opts.method==='PUT'){puts++;throw Error('연결 끊김');}return ++reads===1?detail():detail(['b','c','a'],8);};assert.equal(await t.hook.move('a',null),true);await t.settle();assert.equal(puts,1);assert.equal(reads,2);assert.equal(t.saved,1);assert.equal(t.failed,0);assert.equal(t.hook.error,'');
 }finally{t.close();}
});
test('a rejected write restores the authoritative order and unknown results are never claimed as rolled back',async()=>{
 for(const unavailable of [false,true]){const t=setup();try{let reads=0;env.api=async(_path,opts={})=>{if(opts.method==='PUT')throw Error('다른 곳에서 수정했어요.');if(++reads===2&&unavailable)throw Error('offline');return detail(['a','b','c'],reads===1?7:9);};assert.equal(await t.hook.move('a',null),false);await t.settle();assert.deepEqual(t.hook.pages.map(p=>p.id),['a','b','c']);assert.equal(t.failed,1);assert.equal(t.saved,0);assert.match(t.hook.error,unavailable?/결과를 확인하지 못/:/다른 곳/);
 }finally{t.close();}}
});
test('logout or unmount prevents late writes and success notices',async()=>{
 for(const unmount of [false,true]){const t=setup();try{let release;t.options.flush=()=>new Promise(r=>release=r);t.render();const p=t.hook.move('a',null);if(unmount)t.close();else t.request.current.abort();release(true);await p;assert.equal(t.saved,0);assert.equal(t.events.filter(e=>e.method==='PUT').length,0);
 }finally{if(!unmount)t.close();}}
});
test.after(()=>rm(dir,{recursive:true,force:true}));
