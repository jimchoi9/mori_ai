import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';

await build({entryPoints:['src/features/goods/TestCheckout.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'goods-checkout-check.mjs',plugins:[{name:'harness',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react'?
  `export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d);`:
  a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx;`:
  a.path==='react-router'?`export const Link='link',useNavigate=()=>p=>navigation.push(p);`:
  `export const useQuery=()=>query,useQueryClient=()=>({invalidateQueries:async()=>{}});`}));
}}]});
const {TestCheckout}=await import('../goods-checkout-check.mjs');
const design={id:'design',version:1,album_id:null,production_started:false};
const receipt={id:'purchase',mode:'test',status:'simulated',album_id:'album',album_status:'draft'};
function nodes(t){if(!t||typeof t!=='object')return [];if(Array.isArray(t))return t.flatMap(nodes);return [t,...nodes(t.props?.children)];}
function harness(initial=design){
 let index=0,props=initial;const cells=[],effects=[],pending=[];
 globalThis.window=new EventTarget();window.location={origin:'http://localhost'};
 globalThis.query={data:{goods_checkout_mode:'test'},isPending:false,isError:false};
 globalThis.navigation=[];
 globalThis.hooks={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],next=>{cells[i]=typeof next==='function'?next(cells[i]):next;}];},effect(f,deps){const i=index++,prev=effects[i];if(!prev||deps?.some((v,j)=>v!==prev.deps[j]))pending.push(()=>{prev?.cleanup?.();effects[i]={deps,cleanup:f()};});}};
 return {render(next=props){props=next;index=0;const tree=TestCheckout({design:props,userId:'user'});pending.splice(0).forEach(f=>f());return tree;},dispose(){effects.forEach(e=>e?.cleanup?.());}};
}
const action=t=>nodes(t).find(n=>n.type?.name==='GlassButton');
const reply=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});

test('test checkout explains no charge and blocks double clicks until album is ready',async()=>{
 const h=harness(),calls=[];let finish;
 globalThis.fetch=(url,options)=>{calls.push({url,...options});return new Promise(resolve=>{finish=()=>resolve(reply(receipt));});};
 let tree=h.render();assert.match(JSON.stringify(tree),/실제 요금 청구/);
 const first=action(tree).props.onClick();action(tree).props.onClick();
 assert.equal(calls.length,1);assert.equal(action(h.render()).props.disabled,true);
 finish();await first;
 // onClick is intentionally fire-and-forget; wait for the fetch continuation.
 await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(navigation,['/albums/album/edit']);h.dispose();
});

test('lost response retry keeps the same request key and frozen design version',async()=>{
 const h=harness(),calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,...options});if(calls.length===1)throw TypeError('offline');return reply(receipt);};
 action(h.render()).props.onClick();await new Promise(r=>setTimeout(r,0));
 const tree=h.render({...design,version:2});assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));
 action(tree).props.onClick();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 assert.equal(calls[0].body,calls[1].body);assert.equal(JSON.parse(calls[1].body).expected_version,1);
 assert.deepEqual(navigation,['/albums/album/edit']);h.dispose();
});

test('disabled mode never exposes a checkout and existing receipt opens the correct album stage',()=>{
 const h=harness();query.data.goods_checkout_mode='disabled';assert.equal(h.render(),null);
 const tree=h.render({...design,test_purchase:{...receipt,album_status:'review_ready'}});
 assert.equal(action(tree),undefined);
 assert.equal(nodes(tree).find(n=>n.type==='link').props.to,'/albums/album/review');h.dispose();
});

test('deleted receipt stays visibly deleted without a new checkout action',()=>{
 const h=harness({...design,test_purchase:{...receipt,album_status:'deleted'}});
 const tree=h.render();assert.match(JSON.stringify(tree),/삭제되었습니다/);
 assert.equal(action(tree),undefined);assert.ok(!nodes(tree).some(n=>n.type==='link'));h.dispose();
});

test('session expiry aborts checkout and prevents navigation from a late response',async()=>{
 const h=harness();let signal,finish;
 globalThis.fetch=(url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=()=>resolve(reply(receipt));});};
 action(h.render()).props.onClick();window.dispatchEvent(new Event('mori:session-expired'));
 assert.equal(signal.aborted,true);finish();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(navigation,[]);h.dispose();
});
test.after(()=>unlink('goods-checkout-check.mjs'));
