import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
await build({entryPoints:['src/features/goods/GoodsWorkspace.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},outfile:'goods-workspace-check.mjs',plugins:[{name:'hooks',setup(b){b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'harness'}));b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react'?`export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d),useLayoutEffect=useEffect;`:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react-router'?`export const Link='link',useBlocker=()=>({state:'unblocked'});`:`export const useQuery=()=>({data:{styles:[]},isError:false});`}));}}]});
const {GoodsWorkspace}=await import('../goods-workspace-check.mjs');
function harness(){let index=0,mounted=true,updatesAfterUnmount=0;const cells=[],effects=[],pending=[];
 globalThis.hooks={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],next=>{if(!mounted)updatesAfterUnmount++;cells[i]=typeof next==='function'?next(cells[i]):next;}];},effect(f,deps){const i=index++,prev=effects[i];if(!prev||deps?.some((v,j)=>v!==prev.deps[j])){pending.push(()=>{prev?.cleanup?.();effects[i]={deps,cleanup:f()};});}}};
 return {render(){index=0;const tree=GoodsWorkspace({userId:'u'});pending.splice(0).forEach(f=>f());return tree;},unmount(){mounted=false;effects.forEach(e=>e?.cleanup?.());},get late(){return updatesAfterUnmount;}};
}
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
const find=(tree,match)=>{const n=nodes(tree).find(match);assert.ok(n,'expected UI element');return n;};
const component=(tree,name)=>find(tree,n=>n.type?.name===name);
const button=(tree,label)=>find(tree,n=>n.type?.name==='GlassButton'&&n.props.children===label);
const tick=()=>new Promise(r=>setTimeout(r,0));
const reply=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
function environment(){globalThis.window=new EventTarget();window.location={origin:'http://localhost'};window.confirm=()=>true;window.setTimeout=()=>0;globalThis.Image=class{set src(v){if(v)queueMicrotask(()=>this.onload?.());}};delete globalThis.createImageBitmap;const calls=[];let count=0;const config={failure:null,wait:null};globalThis.fetch=async(url,options={})=>{calls.push({url,...options});if(options.method==='DELETE')return new Response(null,{status:204});if(url==='/api/v1/goods/work'){const id=++count===1?'old':'new';if(id==='new'&&config.createWait)return config.createWait(options,id);return reply({id});}if(url.endsWith('/source')){if(url.includes('/new/')&&options.method==='PUT'&&config.wait)return config.wait(options.signal);if(url.includes('/new/')&&config.failure==='network')throw TypeError('offline');if(url.includes('/new/')&&config.failure===options.method)return new Response(JSON.stringify({error:{code:'IMAGE_DECODE_FAILED'}}),{status:config.status??422});if(options.method==='PUT')return new Response(null,{status:204});if(url.includes('/new/')&&config.failure==='preview')throw TypeError('offline');return new Response(new Blob(['webp'],{type:'image/webp'}));}return reply({revisions:[{id:'revision',request_key:'k',parent_id:null,message:'old request',style:'book',status:'ready',image_url:'/revision.png',error_code:null,fake:false}]});};return {calls,config};}
async function select(h,file=new File(['heic'],'x.HEIC')){let tree=h.render();const input=find(tree,n=>n.type==='input'&&n.props.type==='file');input.props.onChange({target:{files:[file],value:'photo'}});for(let i=0;i<8;i++)await tick();return h.render();}
async function existing(h){let tree=h.render();component(tree,'StylePicker').props.onSelect('book');tree=h.render();button(tree,'이 모양으로 시작하기').props.onClick();await select(h);await tick();tree=h.render();button(tree,'이 시안으로 고리 위치 정하기').props.onClick();tree=h.render();component(tree,'GoodsMockup').props.onChange({holeX:.3,holeY:.2,widthMm:60});tree=h.render();button(tree,'시안으로 돌아가기').props.onClick();return h.render();}
test('workspace failed source PUT or preview leaves original revision, source and placement usable',async()=>{
 for(const failure of ['PUT','preview']){const e=environment(),h=harness();let tree=await existing(h);const before=component(tree,'GoodsMockup').props;e.config.failure=failure;tree=await select(h);const after=component(tree,'GoodsMockup').props;assert.equal(after.src,before.src);assert.deepEqual(after.placement,{holeX:.3,holeY:.2,widthMm:60});assert.equal(component(tree,'RevisionHistory').props.selectedId,'revision');assert.equal(button(tree,'시안 생성·수정').props.disabled,true);assert.ok(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/new')));assert.ok(!e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/old')));assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));h.unmount();}
});
test('workspace unmount aborts pending upload and disposes candidate without stale state updates',async()=>{
 const e=environment(),h=harness();await existing(h);let observed;e.config.wait=signal=>new Promise((_,reject)=>{observed=signal;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});const pending=select(h);await tick();assert.ok(observed);h.unmount();assert.equal(observed.aborted,true);await pending;assert.equal(h.late,0);assert.ok(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/new')));assert.ok(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/old')));
});

test('unmount during work creation waits for returned ID then discards candidate without uploading',async()=>{
 const e=environment(),h=harness();await existing(h);let resolveCreate;
 e.config.createWait=(options,id)=>new Promise((resolve,reject)=>{resolveCreate=()=>resolve(reply({id}));options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
 const pending=select(h);await tick();assert.ok(resolveCreate);h.unmount();resolveCreate();await pending;
 assert.equal(h.late,0);assert.ok(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/new')));assert.ok(!e.calls.some(c=>c.method==='PUT'&&c.url.includes('/new/')));
});

test('workspace replacement failures preserve source, revisions, selection, draft and placement across HTTP/network/preprocess failures',async()=>{
 for(const failure of [401,403,422,500,503,'network','preprocess']){
  const e=environment(),h=harness();let tree=await existing(h);
  find(tree,n=>n.type==='textarea').props.onChange({target:{value:'keep this request'}});tree=h.render();
  const before=component(tree,'GoodsMockup').props,history=component(tree,'RevisionHistory').props;
  e.config.failure=failure==='network'?'network':'PUT';e.config.status=typeof failure==='number'?failure:422;
  tree=await select(h,failure==='preprocess'?new File([new Uint8Array(20*1024*1024+1)],'large.jpg',{type:'image/jpeg'}):undefined);
  assert.equal(component(tree,'GoodsMockup').props.src,before.src,String(failure));
  assert.deepEqual(component(tree,'GoodsMockup').props.placement,before.placement);
  assert.deepEqual(component(tree,'RevisionHistory').props.items,history.items);
  assert.equal(component(tree,'RevisionHistory').props.selectedId,history.selectedId);
  assert.equal(find(tree,n=>n.type==='textarea').props.value,'keep this request');
  assert.equal(button(tree,'시안 생성·수정').props.disabled,false);
  assert.ok(!e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/old')));
  assert.equal(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/new')),failure!=='preprocess');
  assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));
  h.unmount();
 }
});
