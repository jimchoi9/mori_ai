import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

await build({stdin: {contents: `export {selectElement} from './src/features/goods/suggestions/selection'; export {startRotation} from './src/features/goods/suggestions/rotation'; export {SuggestionDeck} from './src/features/goods/suggestions/deck'; export {fallbackSuggestions} from './src/features/goods/suggestions/catalog'; export {usePromptSuggestions} from './src/features/goods/suggestions/usePromptSuggestions';`, resolveDir: process.cwd(), loader: 'ts'},
  bundle: true, platform: 'node', format: 'esm', outfile: 'goods-suggestions-check.mjs',
  plugins: [{name: 'hooks', setup(b) {
    b.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'harness'}));
    b.onLoad({filter: /.*/, namespace: 'harness'}, () => ({contents: 'export const useState=v=>hooks.state(v),useRef=v=>hooks.ref(v),useEffect=(f,d)=>hooks.effect(f,d);'}));
  }}],
});
const {selectElement, startRotation, SuggestionDeck, fallbackSuggestions, usePromptSuggestions} = await import('../goods-suggestions-check.mjs');

test('each option and stage has ten unique short elements in one stable strip', () => {
  for (const style of ['photo','illustration','cutout','badge','book','free']) {
    for (const stage of ['start','photo','edit']) for (const product of ['keyring','magnet']) {
      const candidates=fallbackSuggestions(style,stage,product);
      assert.equal(candidates.length,10);
      assert.equal(new Set(candidates.map(i=>i.prompt)).size,10);
      assert.ok(candidates.every(i=>i.prompt.length<=24));
      const deck=new SuggestionDeck(candidates);
      assert.deepEqual(deck.current,candidates);
      assert.deepEqual(deck.next(),candidates);
    }
  }
});

test('actual AI candidates replace the strip without filler or duplicates', () => {
  const deck=new SuggestionDeck(fallbackSuggestions('badge','photo'));
  const items=Array.from({length:10},(_,i)=>({id:String(i),prompt:`실제 후보 ${i}`,category:'border'}));
  deck.accept([...items,items[0]]);
  assert.deepEqual(deck.current,items);
  deck.accept([]); assert.deepEqual(deck.current,items);
});

test('photo and edit fallbacks vary by option and product without switching formats', () => {
  const styles = ['photo','illustration','cutout','badge','book','free'];
  for (const stage of ['photo','edit']) {
    const firstSets = styles.map(style => fallbackSuggestions(style, stage).slice(0,3).map(i=>i.prompt).join('|'));
    assert.equal(new Set(firstSets).size, 6);
    for (const style of styles) {
      assert.notDeepEqual(fallbackSuggestions(style,stage,'keyring').map(i=>i.prompt),
        fallbackSuggestions(style,stage,'magnet').map(i=>i.prompt));
    }
    assert.ok(fallbackSuggestions('photo',stage).every(i=>!/만화|수채화|캐릭터/.test(i.prompt)));
    assert.ok(fallbackSuggestions('cutout',stage).every(i=>!/별|풍경|액자/.test(i.prompt)));
  }
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

test('option changes ignore stale responses and keep base ideas instantly usable', async () => {
  const calls=[];
  globalThis.fetch=async(url,options)=>new Promise(resolve=>calls.push({resolve,body:JSON.parse(options.body)}));
  const h=harness(props);
  const first=h.render(); assert.equal(first.items.length,10);
  await tick(330); assert.equal(calls.length,1);
  h.render({style:'book'}); await tick(330); assert.equal(calls.length,2);
  calls[0].resolve(reply(custom('과거'))); await tick(0);
  calls[1].resolve(reply(custom('현재'))); await tick(0);
  let state=h.render(); state.next(); state=h.render();
  assert.ok(state.items.every(i=>i.prompt.startsWith('현재')));
  h.unmount(); assert.equal(h.late,0);
});

test('failure preserves refresh and late unmounted responses never update state', async () => {
  globalThis.fetch=async()=>{throw TypeError('offline');};
  const h=harness(props); const old=h.render().items;
  await tick(330); let state=h.render(); state.next(); state=h.render();
  assert.equal(state.items.length,10); assert.deepEqual(state.items,old); h.unmount();
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

test('fallback keeps basic ideas and only an explicit refresh requests the next AI batch', async () => {
  const batches=[];
  globalThis.fetch=async(url,options)=>{
    const {batch}=JSON.parse(options.body);batches.push(batch);
    return batches.length===1
      ? new Response(JSON.stringify({data:{source:'fallback',batch,items:[]}}),{headers:{'Content-Type':'application/json'}})
      : reply(custom('사진맞춤'));
  };
  const h=harness(props);h.render();await tick(330);h.render();await tick(100);
  assert.deepEqual(batches,[0]);
  h.render().next();await tick(0);
  assert.deepEqual(batches,[0,1]);
  h.render().next();const state=h.render();
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
