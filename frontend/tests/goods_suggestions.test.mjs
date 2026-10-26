import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

await build({stdin: {contents: `export {selectElement} from './src/features/goods/suggestions/selection'; export {startRotation, advanceStrip} from './src/features/goods/suggestions/rotation'; export {SuggestionDeck} from './src/features/goods/suggestions/deck'; export {usePromptSuggestions} from './src/features/goods/suggestions/usePromptSuggestions';`, resolveDir: process.cwd(), loader: 'ts'},
  bundle: true, platform: 'node', format: 'esm', outfile: 'goods-suggestions-check.mjs',
  plugins: [{name: 'hooks', setup(b) {
    b.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'harness'}));
    b.onLoad({filter: /.*/, namespace: 'harness'}, () => ({contents: 'export const useState=v=>hooks.state(v),useRef=v=>hooks.ref(v),useEffect=(f,d)=>hooks.effect(f,d);'}));
  }}],
});
const {selectElement, startRotation, advanceStrip, SuggestionDeck, usePromptSuggestions} = await import('../goods-suggestions-check.mjs');

test('actual AI candidates replace the strip without filler or duplicates', () => {
  const deck=new SuggestionDeck();
  const items=Array.from({length:10},(_,i)=>({id:String(i),prompt:`실제 후보 ${i}`,category:'border'}));
  deck.accept([...items,items[0]]);
  assert.deepEqual(deck.current,items);
  deck.accept([]); assert.deepEqual(deck.current,items);
});

function harness(initial) {
  let index=0, mounted=true, late=0, props=initial;
  const cells=[], effects=[], pending=[];
  globalThis.hooks = {
    ref(v) {const i=index++; return cells[i]??={current:v};},
    state(v) {const i=index++; if(!(i in cells))cells[i]=v; return [cells[i],next=>{if(!mounted)late++; cells[i]=typeof next==='function'?next(cells[i]):next;}];},
    effect(f,deps) {const i=index++,old=effects[i]; if(!old||deps.some((d,j)=>d!==old.deps[j]))pending.push(()=>{old?.cleanup?.(); effects[i]={deps,cleanup:f()};});},
  };
  globalThis.window={setTimeout,clearTimeout,location:{origin:'http://localhost'},dispatchEvent(){}};
  return {
    render(changes={}) {props={...props,...changes}; index=0; const output=usePromptSuggestions(props); pending.splice(0).forEach(f=>f()); return output;},
    unmount() {mounted=false;effects.forEach(e=>e?.cleanup?.());},
    get late() {return late;},
  };
}
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const props={userId:'owner',workId:'work',parentId:null,style:'badge',product:'keyring',hasPhoto:true,enabled:true,disabled:false};
const reply=items=>new Response(JSON.stringify({data:{source:'ai',batch:0,items}}),{headers:{'Content-Type':'application/json'}});
const custom=prefix=>[0,1,2,3,4,5,6,7,8,9].map(i=>({id:`${prefix}${i}`,prompt:`${prefix} 새로운 아이디어 ${i}`,category: ['medium','background','border'][i%3]}));

test('option changes start empty and ignore stale responses', async () => {
  const calls=[];
  globalThis.fetch=async(url,options)=>new Promise(resolve=>calls.push({resolve,body:JSON.parse(options.body)}));
  const h=harness(props);
  const first=h.render(); assert.equal(first.items.length,0);
  await tick(330); assert.equal(calls.length,1);
  h.render({style:'book'}); await tick(330); assert.equal(calls.length,2);
  calls[0].resolve(reply(custom('과거'))); await tick(0);
  calls[1].resolve(reply(custom('현재'))); await tick(0);
  let state=h.render();
  assert.ok(state.items.every(i=>i.prompt.startsWith('현재')));
  h.unmount(); assert.equal(h.late,0);
});

test('failure preserves refresh and late unmounted responses never update state', async () => {
  globalThis.fetch=async()=>{throw TypeError('offline');};
  const h=harness(props); const old=h.render().items;
  await tick(330); let state=h.render(); state.next(); state=h.render();
  assert.equal(state.items.length,0); assert.deepEqual(state.items,old); h.unmount();
  let release;
  globalThis.fetch=async()=>new Promise(resolve=>{release=resolve;});
  const second=harness(props); second.render(); await tick(330); second.unmount();
  release(reply(custom('늦은'))); await tick(0); assert.equal(second.late,0);
});

test('disabled or photo-less contexts do not call the recommendation API', async () => {
  let calls=0; globalThis.fetch=async()=>{calls++;return reply(custom('AI'));};
  const h=harness({...props,disabled:true}); h.render(); await tick(330); assert.equal(calls,0);
  h.render({disabled:false,workId:null,hasPhoto:false}); await tick(330); assert.equal(calls,0); h.unmount();
});

test('fallback leaves no invented candidates and only an explicit refresh requests the next AI batch', async () => {
  const batches=[];
  globalThis.fetch=async(url,options)=>{
    const {batch}=JSON.parse(options.body);batches.push(batch);
    return batches.length===1
      ? new Response(JSON.stringify({data:{source:'fallback',batch,items:[]}}),{headers:{'Content-Type':'application/json'}})
      : reply(custom('사진맞춤'));
  };
  const h=harness(props);h.render();await tick(330);h.render();await tick(100);
  assert.deepEqual(batches,[0]);assert.deepEqual(h.render().items,[]);assert.match(h.render().feedback,/가져오지 못/);
  h.render().next();await tick(0);
  assert.deepEqual(batches,[0,1]);
  const state=h.render();
  assert.ok(state.items.every(i=>i.prompt.startsWith('사진맞춤')));
  h.unmount();
});


test('element choices replace their own category, preserve prose and can be toggled off', () => {
  const chip=(category,prompt)=>({id:prompt,category,prompt});
  let state=selectElement('우리 사진으로 만들어줘',chip('medium','수채화 스타일로'),{});
  state=selectElement(state.text,chip('border','꽃 장식 테두리로'),state.inserted);
  state=selectElement(state.text,chip('medium','3D 그림체로'),state.inserted);
  assert.equal(state.text,'우리 사진으로 만들어줘\n3D 그림체로\n꽃 장식 테두리로');
  state=selectElement(state.text,chip('medium','3D 그림체로'),state.inserted);
  assert.equal(state.text,'우리 사진으로 만들어줘\n꽃 장식 테두리로');
  const edited=selectElement('내가 수정한 문장',chip('border','얇은 테두리로'),state.inserted);
  assert.equal(edited.text,'내가 수정한 문장\n얇은 테두리로');
  const manual=selectElement('수채화 스타일로',chip('medium','수채화 스타일로'),{});
  assert.equal(manual.text,'수채화 스타일로'); assert.deepEqual(manual.inserted,{});
  assert.equal(selectElement('x'.repeat(3000),chip('medium','수채화로'),{}).accepted,false);
});

test('continuous animation pauses, caps elapsed time, cleans up and never fetches', async () => {
  let callback, stopped=false, paused=false, distance=0;
  const stop=startRotation(pixels=>distance+=pixels,()=>paused,fn=>{callback=fn;return 42;},id=>{assert.equal(id,42);stopped=true;});
  callback(0);callback(50);assert.equal(distance,0.8);
  paused=true;callback(100);assert.equal(distance,0.8);
  paused=false;callback(10000);assert.equal(distance,1.6);
  stop();assert.ok(stopped);
  let calls=0;globalThis.fetch=async()=>{calls++;return reply(custom('AI'));};
  const h=harness(props);h.render();await tick(330);
  for(let i=0;i<15;i++) h.render();
  await tick(0);assert.equal(calls,1);h.unmount();
});


test('no-photo hook stays empty and batch cap preserves last AI results without local cycling',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return reply(custom(`AI${calls}`));};
 const local=harness({...props,workId:null,hasPhoto:false});let state=local.render();const old=state.items;
 state.next();state=local.render();assert.deepEqual(state.items,[]);assert.equal(calls,0);local.unmount();
 const h=harness(props);h.render();await tick(330);
 for(let i=0;i<3;i++){h.render().next();await tick(0);}
 assert.equal(calls,4);
 const before=h.render().items;h.render().next();state=h.render();
 assert.deepEqual(state.items,before);assert.equal(state.exhausted,true);assert.match(state.feedback,/모두 확인/);assert.equal(calls,4);h.unmount();
});

test('AI refresh immediately exposes loading state and ignores duplicate clicks',async()=>{
 let resolve,calls=0;globalThis.fetch=async()=>{calls++;return new Promise(done=>{resolve=done;});};
 const h=harness(props);h.render();await tick(330);
 let state=h.render();assert.equal(state.loading,true);assert.match(state.feedback,/찾고/);
 state.next();assert.equal(calls,1);
 resolve(reply(custom('새후보')));await tick(0);state=h.render();assert.equal(state.loading,false);h.unmount();
});

test('finite suggestion strip reverses at edges without wrapping or duplicating candidates',()=>{
  assert.deepEqual(advanceStrip(98,100,4,1),{position:100,direction:-1,atEdge:true});
  assert.deepEqual(advanceStrip(100,100,4,-1),{position:96,direction:-1,atEdge:false});
  assert.deepEqual(advanceStrip(2,100,4,-1),{position:0,direction:1,atEdge:true});
});

test('refresh keeps previous AI results while waiting and never substitutes local suggestions',async()=>{
 let resolve,calls=0;
 globalThis.fetch=async()=>{calls++;return calls===1?reply(custom('첫응답').slice(0,2)):new Promise(done=>{resolve=done;});};
 const h=harness(props);assert.deepEqual(h.render().items,[]);await tick(330);
 const before=h.render().items;assert.equal(before.length,2);
 h.render().next();assert.deepEqual(h.render().items,before);assert.equal(h.render().loading,true);
 resolve(new Response(JSON.stringify({data:{source:'fallback',batch:1,items:[]}}),{headers:{'Content-Type':'application/json'}}));
 await tick(0);assert.deepEqual(h.render().items,before);assert.match(h.render().feedback,/이전 AI/);h.unmount();
});

test('daily quota explains reset time and stops refresh without substituting candidates',async()=>{
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'SUGGESTIONS_DAILY_LIMIT',details:{limit:20,retry_at:'2026-10-24T00:00:00+00:00'}}}),{status:429,headers:{'Content-Type':'application/json'}});};
 const h=harness(props);h.render();await tick(330);const state=h.render();
 assert.deepEqual(state.items,[]);assert.equal(state.exhausted,true);assert.match(state.feedback,/오늘의 AI 추천 요청 한도/);assert.match(state.feedback,/다시 이용/);
 state.next();assert.equal(calls,1);h.unmount();
});

test('member can request beyond four batches while guest remains bounded',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return reply(custom(`AI${calls}`));};
 const h=harness({...props,isGuest:false});h.render();await tick(330);
 for(let i=0;i<5;i++){h.render().next();await tick(0);}
 assert.equal(calls,6);assert.equal(h.render().exhausted,false);h.unmount();
});
