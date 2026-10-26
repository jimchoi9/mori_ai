import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
await build({entryPoints:['src/features/goods/GoodsWorkspace.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},outfile:'goods-workspace-check.mjs',plugins:[{name:'hooks',setup(b){b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'harness'}));b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react'?`export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d),useLayoutEffect=useEffect;`:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react-router'?`export const Link='link',useBlocker=()=>({state:'unblocked'}),useNavigate=()=>()=>{};`:`export const useQuery=()=>({data:{styles:[]},isError:false}),useQueryClient=()=>({invalidateQueries:async()=>{}});`}));}}]});
const {GoodsWorkspace}=await import('../goods-workspace-check.mjs');
function harness(props={}){let index=0,mounted=true,updatesAfterUnmount=0;const cells=[],effects=[],pending=[];
 globalThis.hooks={ref(v){const i=index++;return cells[i]??={current:v};},state(v){const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],next=>{if(!mounted)updatesAfterUnmount++;cells[i]=typeof next==='function'?next(cells[i]):next;}];},effect(f,deps){const i=index++,prev=effects[i];if(!prev||deps?.some((v,j)=>v!==prev.deps[j])){pending.push(()=>{prev?.cleanup?.();effects[i]={deps,cleanup:f()};});}}};
 return {render(){index=0;const tree=GoodsWorkspace({userId:'u',...props});pending.splice(0).forEach(f=>f());return tree;},unmount(){mounted=false;effects.forEach(e=>e?.cleanup?.());},get late(){return updatesAfterUnmount;}};
}
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
const find=(tree,match)=>{const n=nodes(tree).find(match);assert.ok(n,'expected UI element');return n;};
const component=(tree,name)=>find(tree,n=>n.type?.name===name);
function labelText(value){if(typeof value==='string')return value;if(value==null||typeof value!=='object')return '';if(Array.isArray(value))return value.map(labelText).join('');return value?.props?.['aria-hidden']? '':labelText(value?.props?.children);}
const button=(tree,label)=>find(tree,n=>(n.type==='button'||n.type?.name==='GlassButton')&&(n.props?.['aria-label']===label||labelText(n.props?.children)===label));
const generate=async h=>{find(h.render(),n=>n.type==='form').props.onSubmit({preventDefault(){}});for(let i=0;i<8;i++)await tick();return h.render();};
const tick=()=>new Promise(r=>setTimeout(r,0));
const reply=data=>new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
function environment(){globalThis.window=new EventTarget();window.location={origin:'http://localhost'};window.confirm=()=>true;window.setTimeout=()=>0;globalThis.Image=class{set src(v){if(v)queueMicrotask(()=>this.onload?.());}};delete globalThis.createImageBitmap;const calls=[];let count=0;const config={failure:null,wait:null};globalThis.fetch=async(url,options={})=>{calls.push({url,...options});if(options.method==='DELETE'){if(config.discardWait&&url.endsWith('/old')){const wait=config.discardWait;config.discardWait=null;return wait();}return new Response(null,{status:204});}if(url==='/api/v1/goods/work'){const id=++count===1?'old':'new';if(id==='new'&&config.createWait)return config.createWait(options,id);return reply({id});}if(url.endsWith('/source')){if(url.includes('/new/')&&options.method==='PUT'&&config.wait)return config.wait(options.signal);if(url.includes('/new/')&&config.failure==='network')throw TypeError('offline');if(url.includes('/new/')&&config.failure===options.method)return new Response(JSON.stringify({error:{code:'IMAGE_DECODE_FAILED'}}),{status:config.status??422});if(options.method==='PUT')return new Response(null,{status:204});if(url.includes('/new/')&&config.failure==='preview')throw TypeError('offline');return new Response(new Blob(['webp'],{type:'image/webp'}));}if(url.endsWith('/revisions')&&options.method==='POST')return reply({id:'revision'});return reply({revisions:[{id:'revision',request_key:'k',parent_id:null,message:'old request',style:'book',status:'ready',image_url:'/revision.png',error_code:null,fake:false}]});};return {calls,config};}
async function select(h,file=new File(['heic'],'x.HEIC')){let tree=h.render();const input=find(tree,n=>n.type==='input'&&n.props.type==='file');input.props.onChange({target:{files:[file],value:'photo'}});for(let i=0;i<8;i++)await tick();return h.render();}
async function existing(h){let tree=h.render();component(tree,'StylePicker').props.onSelect('book');tree=h.render();await select(h);await tick();tree=h.render();find(tree,n=>n.type==='textarea').props.onChange({target:{value:'a travel memory'}});tree=h.render();tree=await generate(h);component(tree,'RevisionHistory').props.onPreview('revision');tree=h.render();component(tree,'GoodsMockup').props.onChange({holeX:.3,holeY:.2,widthMm:60});tree=h.render();button(tree,'대화에서 더 수정하기').props.onClick();return h.render();}
test('workspace failed source PUT or preview leaves original revision, source and placement usable',async()=>{
 for(const failure of ['PUT','preview']){const e=environment(),h=harness();let tree=await existing(h);const before=component(tree,'GoodsMockup').props;e.config.failure=failure;tree=await select(h);const after=component(tree,'GoodsMockup').props;assert.equal(after.src,before.src);assert.deepEqual(after.placement,{holeX:.3,holeY:.2,widthMm:60});assert.equal(component(tree,'RevisionHistory').props.selectedId,'revision');assert.equal(button(tree,'이미지 만들기').props.disabled,true);assert.ok(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/new')));assert.ok(!e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/old')));assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));h.unmount();}
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
  assert.equal(button(tree,'이미지 만들기').props.disabled,false);
  assert.ok(!e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/old')));
  assert.equal(e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/new')),failure!=='preprocess');
  assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));
  h.unmount();
 }
});

test('first screen supports text-only creation without a photo or login wall',async()=>{
 const e=environment(),h=harness({guest:{remaining:3,work_id:null}});let tree=h.render();
 assert.ok(nodes(tree).some(n=>n.type==='textarea'));assert.ok(nodes(tree).some(n=>n.type==='input'&&n.props.type==='file'));
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'바닷가 여행을 담은 조개'}});tree=h.render();tree=await generate(h);
 const request=e.calls.find(c=>c.url.endsWith('/revisions')&&c.method==='POST');assert.ok(request);assert.equal(JSON.parse(request.body).use_source,false);
 assert.ok(component(tree,'RevisionHistory'));h.unmount();assert.ok(!e.calls.some(c=>c.method==='DELETE'&&c.url.endsWith('/old')));
});
test('first photo attachment preserves the typed description',async()=>{
 environment();const h=harness();let tree=h.render();find(tree,n=>n.type==='textarea').props.onChange({target:{value:'keep my travel description'}});
 tree=await select(h);assert.equal(find(tree,n=>n.type==='textarea').props.value,'keep my travel description');h.unmount();
});
test('photo-only generation uses the selected style and an empty request, while empty input stays disabled',async()=>{
 const e=environment(),baseFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>/\/goods\/work\/[^/]+$/.test(url)&&!options.method?reply({revisions:[]}):baseFetch(url,options);
 const h=harness({guest:{remaining:3,work_id:null}});let tree=h.render();
 assert.equal(button(tree,'이미지 만들기').props.disabled,true);
 component(tree,'StylePicker').props.onSelect('illustration');tree=await select(h);
 assert.equal(button(tree,'이미지 만들기').props.disabled,false);await generate(h);
 const sent=JSON.parse(e.calls.find(c=>c.url.endsWith('/revisions')).body);
 assert.equal(sent.message,'');assert.equal(sent.style,'illustration');assert.equal(sent.use_source,true);h.unmount();
});
test('suggestion selection preserves the draft and never dispatches generation automatically',async()=>{
 const e=environment(),h=harness();let tree=await existing(h);const before=e.calls.filter(c=>c.url.endsWith('/revisions')).length;globalThis.document={getElementById:()=>({focus(){}})};
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'기존 요청'}});tree=h.render();
 const suggestions=component(tree,'PromptSuggestions').props;
 assert.equal(suggestions.draft,'기존 요청');
 suggestions.onChangeDraft(suggestions.draft+'\n수채화로 그려줘');tree=h.render();
 assert.equal(find(tree,n=>n.type==='textarea').props.value,'기존 요청\n수채화로 그려줘');
 assert.equal(e.calls.filter(c=>c.url.endsWith('/revisions')).length,before);delete globalThis.document;h.unmount();
});
test('exhausted guest can view results but cannot request a fourth generation',async()=>{
 const e=environment(),h=harness({guest:{remaining:0,work_id:null}});let tree=h.render();find(tree,n=>n.type==='textarea').props.onChange({target:{value:'another request'}});tree=h.render();
 assert.equal(button(tree,'이미지 만들기').props.disabled,true);await generate(h);assert.ok(!e.calls.some(c=>c.url.endsWith('/revisions')));h.unmount();
});

test('leaving during new-conversation cleanup ignores its late response',async()=>{
 const e=environment(),h=harness();await existing(h);let release;
 e.config.discardWait=()=>new Promise(resolve=>{release=()=>resolve(new Response(null,{status:204}));});
 button(h.render(),'새 대화').props.onClick();await tick();assert.ok(release);h.unmount();release();for(let i=0;i<4;i++)await tick();assert.equal(h.late,0);
});

test('switching to magnet reuses the selected artwork without another AI request',async()=>{
 const e=environment(),h=harness();let tree=await existing(h);const old=component(tree,'GoodsMockup').props;
 const before=e.calls.filter(c=>c.url.endsWith('/revisions')&&c.method==='POST').length;
 button(tree,'마그네틱').props.onClick();tree=h.render();
 assert.equal(component(tree,'StylePicker').props.product,'magnet');assert.equal(component(tree,'GoodsMockup').props.product,'magnet');assert.equal(component(tree,'GoodsMockup').props.interactive,false);
 assert.equal(component(tree,'GoodsMockup').props.src,old.src);assert.equal(e.calls.filter(c=>c.url.endsWith('/revisions')&&c.method==='POST').length,before);
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'마그네틱으로 더 다듬기'}});await generate(h);
 assert.equal(JSON.parse(e.calls.filter(c=>c.url.endsWith('/revisions')&&c.method==='POST').at(-1).body).product,'magnet');h.unmount();
});
test('magnet choice survives save-login resume and is sent on completion',async()=>{
 const e=environment(),h=harness({resume:{work_id:'old',revision_id:'revision',product:'magnet',placement:{holeX:.5,holeY:0,widthMm:50}}});
 h.render();for(let i=0;i<4;i++)await tick();let tree=h.render();const preview=component(tree,'GoodsMockup').props;
 assert.equal(preview.product,'magnet');
 assert.equal(component(tree,'StylePicker').props.selected,'book');
 // Simulate the renderer confirming this exact product/placement, then save.
 preview.onPreview({status:'ready',key:JSON.stringify([preview.src,preview.product,.5,0,50])});tree=h.render();
 button(tree,'디자인 완성하고 저장').props.onClick();for(let i=0;i<4;i++)await tick();
 const sent=e.calls.find(c=>c.url.endsWith('/complete'));assert.equal(JSON.parse(sent.body).product,'magnet');h.unmount();
});

test('restarting from the original keeps conversation and draft but sends no parent',async()=>{
 const e=environment(),h=harness();let tree=await existing(h);
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'원본 구도로 수채화로'}});tree=h.render();
 button(tree,'시안 첨부 해제').props.onClick();tree=h.render();
 assert.equal(component(tree,'RevisionHistory').props.selectedId,null);
 assert.ok(component(tree,'RevisionHistory').props.items.length>0);
 assert.equal(component(tree,'PromptSuggestions').props.parentId,null);
 assert.equal(find(tree,n=>n.type==='textarea').props.value,'원본 구도로 수채화로');
 await generate(h);const sent=JSON.parse(e.calls.filter(c=>c.url.endsWith('/revisions')&&c.method==='POST').at(-1).body);
 assert.equal(sent.parent_id,null);assert.equal(sent.use_source,true);
 assert.ok(!e.calls.some(c=>c.method==='DELETE'));h.unmount();
});


test('removing every thumbnail sends no images and preserves the draft',async()=>{
 const e=environment(),h=harness();let tree=await existing(h);
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'새로운 바다 그림'}});tree=h.render();
 button(tree,'시안 첨부 해제').props.onClick();tree=h.render();
 button(tree,'원본 사진 첨부 해제').props.onClick();tree=h.render();
 assert.ok(!nodes(tree).some(n=>n.type?.name==='PromptSuggestions'));
 assert.ok(!nodes(tree).some(n=>n.props?.className==='goods-composer-thumbnail'));
 await generate(h);const sent=JSON.parse(e.calls.filter(c=>c.url.endsWith('/revisions')&&c.method==='POST').at(-1).body);
 assert.equal(sent.parent_id,null);assert.equal(sent.use_source,false);assert.equal(sent.message,'새로운 바다 그림');h.unmount();
});


test('blank input and text-only descriptions hide recommendations without disabling generation',()=>{
 environment();const h=harness();let tree=h.render();
 assert.ok(!nodes(tree).some(n=>n.type?.name==='PromptSuggestions'));
 component(tree,'StylePicker').props.onSelect('illustration');tree=h.render();
 find(tree,n=>n.type==='textarea').props.onChange({target:{value:'바닷가의 작은 등대'}});tree=h.render();
 assert.ok(!nodes(tree).some(n=>n.type?.name==='PromptSuggestions'));
 assert.equal(button(tree,'이미지 만들기').props.disabled,false);h.unmount();
});
