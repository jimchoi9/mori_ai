import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'album-delete-dialog-'));
globalThis.window=new EventTarget();globalThis.document={body:{style:{}},activeElement:null};
await build({entryPoints:['src/features/albums/AlbumDeleteButton.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'dialog.mjs'),plugins:[{name:'ui',setup(b){
 b.onResolve({filter:/\.css$|^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('.css')?'':
  a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:
  a.path==='react'?`export const useRef=v=>hooks.ref(v),useState=v=>hooks.state(v),useEffect=(f,d)=>hooks.effect(f,d);`:
  a.path==='react-router'?`export const useNavigate=()=>(path,options)=>env.events.push({navigate:path,options});`:
  `export const useQueryClient=()=>({cancelQueries:async()=>{},setQueryData:(_key,value)=>env.detail=value,setQueriesData:(_key,update)=>env.cache=update(env.cache),removeQueries:options=>env.events.push({removed:options}),invalidateQueries:async()=>{}});`}));
}}]});
const {AlbumDeleteButton}=await import(join(dir,'dialog.mjs'));
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const data=(version=7,title='최신 앨범',count=3)=>({detail:{album:{id:'album',version,title,page_count:count,cover:null},pages:[]},media_access:[]});
const ok=value=>new Response(JSON.stringify({data:value}));
const error=(status,code)=>new Response(JSON.stringify({error:{code}}),{status});
function setup(){
 const cells=[],pending=[],cleanups=new Map();let cursor=0;
 globalThis.env={events:[],cache:{pages:[{items:[{id:'album',cover:{asset_id:'a'}},{id:'other',cover:{asset_id:'b'}}],media_access:[{asset_id:'a'},{asset_id:'b'}]}]}};
 globalThis.hooks={ref:value=>{const i=cursor++;return cells[i]??={current:value};},state:value=>{const i=cursor++;if(!(i in cells))cells[i]=value;return [cells[i],next=>cells[i]=typeof next==='function'?next(cells[i]):next];},effect:(work,deps)=>{const i=cursor++,old=cells[i];if(!old||deps.some((value,n)=>value!==old[n])){cells[i]=deps;pending.push([i,work]);}}};
 const props={albumId:'album',albumTitle:'표시된 이전 이름',userId:'owner',onOpenChange:open=>env.events.push({open}),onDeleted:()=>env.events.push('discard-confirmed')};
 const modal={open:false,showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect:()=>({left:10,right:300,top:100,bottom:700})};
 const h={props,modal,render(){cursor=0;const tree=AlbumDeleteButton(props);for(const node of nodes(tree))if(node.props?.ref){node.props.ref.current=node.type==='dialog'?modal:{isConnected:true,name:node.props.className??node.props.children,focus(){document.activeElement=this;}};}for(const [i,work] of pending.splice(0)){cleanups.get(i)?.();cleanups.set(i,work());}return tree;},find(type,predicate=()=>true){return nodes(this.render()).find(node=>node.type===type&&predicate(node.props));},async open(){this.find('button',p=>p['aria-label']?.includes('앨범 삭제')).props.onClick();await tick();this.render();},type(value){this.find('input').props.onChange({target:{value}});this.render();},confirm(){this.find('button',p=>p.className==='album-delete-confirm').props.onClick();},close(){for(const cleanup of cleanups.values())cleanup?.();}};
 return h;
}
test('opening fetches current target and starts disabled with cancel focused and no forced keyboard',async()=>{
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push(options.method);return ok(data());};const h=setup();await h.open();
 assert.deepEqual(calls,['GET']);assert.equal(h.find('h3').props.children,'최신 앨범');assert.equal(env.detail.detail.album.title,'최신 앨범');assert.equal(h.find('input').props.autoFocus,undefined);assert.equal(h.find('button',p=>p.className==='album-delete-confirm').props.disabled,true);assert.equal(document.activeElement.name,'취소');h.close();
});
test('wrong text and Enter send no delete; cancellation and reopening clear the gate',async()=>{
 let deletes=0;globalThis.fetch=async(_url,options)=>{if(options.method==='DELETE')deletes++;return ok(data());};const h=setup();await h.open();
 for(const word of ['','삭','삭제해']){h.type(word);h.confirm();await tick();assert.equal(deletes,0);}
 h.type('삭제');let prevented=false;h.find('input').props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(deletes,0);
 for(const nativeEvent of [{isComposing:true},{keyCode:229}]){let blocked=false;h.find('input').props.onKeyDown({key:'Enter',nativeEvent,preventDefault(){blocked=true;}});assert.equal(blocked,false);assert.equal(deletes,0);}
 h.find('button',p=>p.children==='취소').props.onClick();h.render();await h.open();assert.equal(h.find('input').props.value,'');assert.equal(deletes,0);h.close();
});
test('double confirm sends one DELETE and waits for local cleanup before navigating',async()=>{
 const calls=[];let resolveDelete,resolveCleanup;
 globalThis.fetch=async(url,options)=>{calls.push([url,options.method]);return options.method==='DELETE'?new Promise(resolve=>resolveDelete=()=>resolve(ok({status:'deleted'}))):ok(data());};
 const h=setup();h.props.onDeleted=()=>new Promise(resolve=>resolveCleanup=resolve);await h.open();h.type('삭제');h.confirm();h.confirm();await tick();
 assert.equal(calls.filter(([,method])=>method==='DELETE').length,1);assert.match(calls.at(-1)[0],/expected_version=7/);
 h.find('button',p=>p.children==='취소').props.onClick();assert.equal(h.modal.open,true);
 resolveDelete();await tick();assert.equal(env.events.some(event=>event.navigate),false);resolveCleanup();await tick();h.render();
 assert.equal(env.events.filter(event=>event.navigate).length,1);assert.deepEqual(env.cache.pages[0].items.map(item=>item.id),['other']);assert.deepEqual(env.cache.pages[0].media_access.map(item=>item.asset_id),['b']);h.close();
});
test('a changed album is never deleted without reviewing current data and retyping',async()=>{
 let version=7,deletes=0;globalThis.fetch=async(_url,options)=>{if(options.method==='DELETE'){deletes++;return ok({status:'deleted'});}return ok(data(version,version===7?'처음 이름':'바뀐 이름',version===7?3:4));};
 const h=setup();await h.open();h.type('삭제');version=8;h.confirm();await tick();h.render();assert.equal(deletes,0);assert.equal(h.find('input').props.value,'');assert.equal(h.find('input').props.disabled,true);
 h.find('button',p=>p.className==='album-delete-review').props.onClick();await tick();h.render();assert.equal(h.find('input').props.disabled,false);assert.equal(h.find('button',p=>p.className==='album-delete-confirm').props.disabled,true);h.type('삭제');h.confirm();await tick();assert.equal(deletes,1);h.close();
});
test('a server version conflict also requires explicit refresh and new confirmation',async()=>{
 globalThis.fetch=async(_url,options)=>options.method==='DELETE'?error(409,'VERSION_CONFLICT'):ok(data());const h=setup();await h.open();h.type('삭제');h.confirm();await tick();h.render();assert.equal(h.find('input').props.value,'');assert.ok(h.find('button',p=>p.className==='album-delete-review'));assert.equal(env.events.includes('discard-confirmed'),false);h.close();
});
test('network uncertainty preserves files and text unless a GET proves disappearance',async()=>{
 let deleted=false,deletes=0;globalThis.fetch=async(_url,options)=>{if(options.method==='DELETE'){deletes++;throw new TypeError('lost response');}return deleted?error(404,'RESOURCE_NOT_FOUND'):ok(data());};
 const h=setup();await h.open();h.type('삭제');h.confirm();await tick();h.render();assert.equal(deletes,1);assert.equal(h.find('input').props.value,'삭제');assert.equal(env.events.includes('discard-confirmed'),false);assert.equal(env.events.some(event=>event.navigate),false);
 // A second explicit request still starts with GET; unavailable targets are not invented as success.
 deleted=true;h.confirm();await tick();assert.equal(deletes,1);assert.equal(env.events.some(event=>event.navigate),false);h.close();
});
test('lost DELETE response followed by 404 acknowledges removal exactly once',async()=>{
 let removed=false;globalThis.fetch=async(_url,options)=>{if(options.method==='DELETE'){removed=true;throw new TypeError('lost response');}return removed?error(404,'RESOURCE_NOT_FOUND'):ok(data());};const h=setup();await h.open();h.type('삭제');h.confirm();await tick();assert.equal(env.events.filter(event=>event==='discard-confirmed').length,1);assert.equal(env.events.filter(event=>event.navigate).length,1);h.close();
});
test('an external busy state blocks deletion even with a correct word',async()=>{
 let deletes=0;globalThis.fetch=async(_url,options)=>{if(options.method==='DELETE')deletes++;return ok(data());};const h=setup();await h.open();h.type('삭제');h.props.disabled=true;h.render();h.confirm();await tick();assert.equal(deletes,0);h.close();
});
test('load failure and mismatched target never offer an enabled confirmation',async()=>{
 for(const response of [()=>error(403,'ACCESS_DENIED'),()=>ok({...data(),detail:{...data().detail,album:{...data().detail.album,id:'someone-else'}}})]){
  globalThis.fetch=async()=>response();const h=setup();await h.open();assert.equal(h.find('input'),undefined);assert.ok(h.find('p',p=>p.role==='alert'));assert.equal(env.events.some(event=>event.navigate),false);h.close();
 }
});
test('logout discards confirmation state and ignores a late successful response',async()=>{
 let resolve;globalThis.fetch=()=>new Promise(done=>resolve=done);const h=setup();h.find('button',p=>p['aria-label']?.includes('앨범 삭제')).props.onClick();h.render();window.dispatchEvent(new Event('mori:logout'));resolve(ok(data()));await tick();h.render();assert.equal(h.modal.open,false);assert.equal(h.find('input'),undefined);assert.equal(env.events.some(event=>event.navigate),false);h.close();
});
test.after(()=>rm(dir,{recursive:true,force:true}));
