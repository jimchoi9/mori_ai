import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/MemoryBook.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'nfc-music-check.mjs',plugins:[{name:'hooks',setup(b){
 b.onResolve({filter:/^react(\/jsx-runtime)?$/},a=>({path:a.path,namespace:'hooks'}));
 b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:`export const useRef=v=>globalThis.h.ref(v),useState=v=>globalThis.h.state(v),useEffect=(f,d)=>globalThis.h.effect(f,d);`}));
}}]});
const {MemoryBook}=await import('../nfc-music-check.mjs');
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function setup(chapters=[],music='blob:test'){
 let index=0,options,destroyed=0,plays=0,pauses=0;const cells=[],effects=[],cleanups=[];
 globalThis.document=new EventTarget();document.hidden=false;
 globalThis.window=new EventTarget();globalThis.addEventListener=window.addEventListener.bind(window);globalThis.removeEventListener=window.removeEventListener.bind(window);
 globalThis.matchMedia=()=>({matches:false});window.createMemoryBook=(_host,o)=>{options=o;o.onPage(0);return {destroy(){destroyed++;}};};
 globalThis.h={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],n=>cells[i]=n];},effect(f){index++;effects.push(f);}};
 const audio={paused:true,volume:1,play(){plays++;this.paused=false;return Promise.resolve();},pause(){pauses++;this.paused=true;}};
 index=0;const tree=MemoryBook({chapters,music});
 for(const n of nodes(tree))if(n.props?.ref)n.props.ref.current=n.type==='audio'?audio:{};
 effects.forEach(f=>cleanups.push(f()));
 return {audio,gesture:(index=0)=>options.onTurn(index),page:index=>options.onPage(index),stats:()=>({destroyed,plays,pauses}),cleanup:()=>cleanups.forEach(f=>f?.())};
}
test('turn gesture starts music, hidden pauses, foreground resumes, and cleanup removes listeners',async()=>{
 const h=setup();h.gesture();await Promise.resolve();assert.equal(h.audio.paused,false);
 document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(h.audio.paused,true);
 document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(h.stats().plays,2);
 h.cleanup();const after=h.stats();assert.equal(after.destroyed,1);assert.equal(h.audio.paused,true);
 document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));assert.deepEqual(h.stats(),after);
});
test('pagehide pauses a one-page book even without a visibility event',async()=>{
 const h=setup();h.gesture();await Promise.resolve();assert.equal(h.audio.paused,false);
 window.dispatchEvent(new Event('pagehide'));assert.equal(h.audio.paused,true);h.cleanup();
});
test('a 50-photo book retains backdrop sources only for nearby pages, restores rebuilt slots, and clears on exit without music',()=>{
 const slot=()=>{const values=new Map();return {clientWidth:390,clientHeight:600,classList:{toggle(){},remove(){}},style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k),getPropertyValue:k=>values.get(k)||''}};};
 const chapters=Array.from({length:50},(_,i)=>{const attrs=new Map(),events=new EventTarget();return {src:`blob:photo-${i}`,text:'memory',media:{naturalWidth:1600,naturalHeight:900,parentElement:slot(),addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),getAttribute:k=>attrs.get(k)||null,removeAttribute:k=>attrs.delete(k),set src(v){attrs.set('src',v);}}};});
 const h=setup(chapters,null),visible=()=>chapters.flatMap((p,i)=>p.media.getAttribute('src')?[i]:[]),backgrounds=()=>chapters.flatMap((p,i)=>p.media.parentElement.style.getPropertyValue('--story-backdrop')?[i]:[]);
 assert.deepEqual(visible(),[0,1]);assert.deepEqual(backgrounds(),[0,1]);
 h.gesture(25);assert.deepEqual(visible(),[24,25,26]);assert.deepEqual(backgrounds(),[24,25,26]);
 assert.equal(chapters[25].media.parentElement.style.getPropertyValue('--story-backdrop'),'url("blob:photo-25")');
 for(const p of chapters)p.media.parentElement=slot();h.page(25);assert.deepEqual(backgrounds(),[24,25,26]);
 h.page(49);assert.deepEqual(visible(),[48,49]);assert.deepEqual(backgrounds(),[48,49]);
 h.cleanup();assert.deepEqual(backgrounds(),[]);assert.equal(h.stats().plays,0);assert.equal(h.stats().destroyed,1);
});
test.after(()=>unlink('nfc-music-check.mjs'));
