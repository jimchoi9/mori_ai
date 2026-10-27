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
function setup(){
 let index=0,options,destroyed=0,plays=0,pauses=0;const cells=[],effects=[],cleanups=[];
 globalThis.document=new EventTarget();document.hidden=false;
 globalThis.window=new EventTarget();globalThis.addEventListener=window.addEventListener.bind(window);globalThis.removeEventListener=window.removeEventListener.bind(window);
 globalThis.matchMedia=()=>({matches:false});window.createMemoryBook=(_host,o)=>{options=o;return {destroy(){destroyed++;}};};
 globalThis.h={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],n=>cells[i]=n];},effect(f){index++;effects.push(f);}};
 const audio={paused:true,volume:1,play(){plays++;this.paused=false;return Promise.resolve();},pause(){pauses++;this.paused=true;}};
 index=0;const tree=MemoryBook({chapters:[],music:'blob:test'});
 for(const n of nodes(tree))if(n.props?.ref)n.props.ref.current=n.type==='audio'?audio:{};
 effects.forEach(f=>cleanups.push(f()));
 return {audio,gesture:()=>options.onTurn(0),stats:()=>({destroyed,plays,pauses}),cleanup:()=>cleanups.forEach(f=>f?.())};
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
test.after(()=>unlink('nfc-music-check.mjs'));
