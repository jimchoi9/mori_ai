import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unlink} from 'node:fs/promises';
await build({entryPoints:['src/features/goods/GoodsPurchaseReview.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'goods-review-check.mjs',plugins:[{name:'review-harness',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react'?`export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d);`:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react-router'?`export const Link='link',useNavigate=()=>(path,options)=>navigation.push({path,...options});`:`export const useQuery=()=>query,useQueryClient=()=>({invalidateQueries:async()=>{}});`}));
}}]});
const {GoodsPurchaseReview}=await import('../goods-review-check.mjs');
const design={id:'design',version:1,product:'magnet',placement:{holeX:.5,holeY:0,widthMm:50},image_url:'/image',album_id:null,production_started:false};
const purchase={id:'purchase',album_id:'album',album_status:'draft',mode:'test',status:'simulated'};
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const text=t=>t==null?'':typeof t==='string'||typeof t==='number'?String(t):Array.isArray(t)?t.map(text).join(''):text(t.props?.children);
const action=(tree,label)=>nodes(tree).find(n=>(n.type==='button'||n.type?.name==='GlassButton')&&text(n.props.children)===label);
const buy=tree=>nodes(tree).find(n=>n.type?.name==='GlassButton');
const tick=()=>new Promise(r=>setTimeout(r,0));
const reply=value=>new Response(JSON.stringify({data:value}));
function harness(overrides={}){
 let cursor=0,mounted=true,late=0,props={userId:'user',guest:false,product:'magnet',design:null,ready:true,saveLocked:false,busy:false,error:'',gift:false,onGiftChange(){},onBack(){},onBusyChange(){},onSave:async()=>design,children:'art',...overrides};
 const cells=[],effects=[],pending=[];
 globalThis.window=new EventTarget();window.location={origin:'http://localhost'};
 globalThis.query={data:{goods_checkout_mode:'test'}};globalThis.navigation=[];
 globalThis.hooks={ref(v){const i=cursor++;return cells[i]??={current:v};},state(v){const i=cursor++;if(!(i in cells))cells[i]=v;return [cells[i],n=>{if(!mounted)late++;cells[i]=typeof n==='function'?n(cells[i]):n;}];},effect(f,deps){const i=cursor++,previous=effects[i];if(!previous||deps.some((d,j)=>d!==previous.deps[j]))pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:f()};});}};
 return {render(next={}){props={...props,...next};cursor=0;const tree=GoodsPurchaseReview(props);pending.splice(0).forEach(f=>f());return tree;},dispose(){mounted=false;effects.forEach(e=>e?.cleanup?.());},get late(){return late;}};
}
test('one final action waits for design save, prevents double submit, then goes straight to photos',async()=>{
 let release,saves=0;const calls=[],h=harness({onSave:()=>{saves++;return new Promise(r=>release=r);}});
 globalThis.fetch=async(url,options)=>{calls.push({url,...options});return reply(purchase);};
 const button=buy(h.render());button.props.onClick();button.props.onClick();
 assert.equal(saves,1);assert.equal(calls.length,0);assert.equal(buy(h.render()).props.disabled,true);
 release(design);await tick();await tick();
 assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].body),{expected_version:1});
 assert.deepEqual(navigation,[{path:'/purchases/purchase/photos',state:{purchaseCompleted:{userId:'user',purchaseId:'purchase'}}}]);h.dispose();
});
test('save failure or refusal never dispatches a purchase',async()=>{
 for(const onSave of [async()=>null,async()=>{throw Error('save failed');}]){
  const h=harness({onSave});let calls=0;globalThis.fetch=async()=>{calls++;return reply(purchase);};
  buy(h.render()).props.onClick();await tick();assert.equal(calls,0);assert.deepEqual(navigation,[]);assert.equal(buy(h.render()).props.disabled,false);h.dispose();
 }
});
test('save-only stays in confirmation and later buying reuses the same committed design',async()=>{
 let saves=0,calls=0;const h=harness({onSave:async()=>{saves++;return design;}});globalThis.fetch=async()=>{calls++;return reply(purchase);};
 action(h.render(),'디자인만 저장').props.onClick();await tick();let tree=h.render();
 assert.equal(saves,1);assert.equal(calls,0);assert.deepEqual(navigation,[]);assert.ok(action(tree,'디자인 저장됨').props.disabled);
 assert.match(text(tree),/디자인을 저장했어요/);buy(tree).props.onClick();await tick();
 assert.equal(saves,1);assert.equal(calls,1);h.dispose();
});
test('lost purchase response freezes version, gift, and idempotency key without saving twice',async()=>{
 let saves=0;const calls=[],h=harness({onSave:async()=>{saves++;return design;}});
 globalThis.fetch=async(url,options)=>{calls.push({url,...options});if(calls.length===1)throw TypeError('offline');return reply(purchase);};
 buy(h.render()).props.onClick();await tick();let tree=h.render({gift:true,design:{...design,version:9}});
 assert.equal(nodes(tree).find(n=>n.type?.name==='PhotoOwnerChoice').props.disabled,true);
 assert.equal(text(buy(tree)),'같은 구매 다시 시도');buy(tree).props.onClick();await tick();
 assert.equal(saves,1);assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.deepEqual(JSON.parse(calls[1].body),{expected_version:1});assert.equal(navigation[0].path,'/purchases/purchase/photos');h.dispose();
});
test('recipient-filled gift goes to registration guidance, never directly to an owner album',async()=>{
 const h=harness({gift:true});let sent;globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return reply(purchase);};
 buy(h.render()).props.onClick();await tick();assert.deepEqual(sent,{expected_version:1,gift:true});
 assert.deepEqual(navigation,[{path:'/purchases/purchase'}]);h.dispose();
});
test('guest login handoff does not buy automatically, and the resumed choice is explicit',async()=>{
 let calls=0;const h=harness({guest:true,gift:true,onSave:async()=>null});globalThis.fetch=async()=>{calls++;return reply(purchase);};
 assert.equal(text(buy(h.render())),'로그인하고 구매 계속하기');buy(h.render()).props.onClick();await tick();assert.equal(calls,0);
 const tree=h.render({guest:false,onSave:async()=>design});assert.equal(calls,0);assert.equal(text(buy(tree)),'테스트 구매하고 선물 준비하기');
 buy(tree).props.onClick();await tick();assert.equal(calls,1);assert.equal(navigation[0].path,'/purchases/purchase');h.dispose();
});
test('unmount during preparation cannot purchase or publish late state',async()=>{
 let release,calls=0;const h=harness({onSave:()=>new Promise(r=>release=r)});globalThis.fetch=async()=>{calls++;return reply(purchase);};
 buy(h.render()).props.onClick();h.dispose();release(design);await tick();assert.equal(calls,0);assert.deepEqual(navigation,[]);assert.equal(h.late,0);
});
test('session expiry aborts an in-flight purchase and ignores its late response',async()=>{
 let release,signal;const h=harness();globalThis.fetch=(_url,options)=>{signal=options.signal;return new Promise(r=>release=()=>r(reply(purchase)));};
 buy(h.render()).props.onClick();await tick();window.dispatchEvent(new Event('mori:session-expired'));assert.equal(signal.aborted,true);
 release();await tick();assert.deepEqual(navigation,[]);h.dispose();
});
test('disabled checkout preserves save-only and incomplete keyring preview cannot dispatch',async()=>{
 let saves=0;const h=harness({onSave:async()=>{saves++;return design;}});query.data.goods_checkout_mode='disabled';
 assert.equal(buy(h.render()),undefined);action(h.render(),'디자인만 저장').props.onClick();await tick();assert.equal(saves,1);h.dispose();
 const keyring=harness({product:'keyring',ready:false,onSave:async()=>{saves++;return design;}});const button=buy(keyring.render());assert.equal(button.props.disabled,true);button.props.onClick();await tick();assert.equal(saves,1);keyring.dispose();
});
test.after(()=>unlink('goods-review-check.mjs'));
