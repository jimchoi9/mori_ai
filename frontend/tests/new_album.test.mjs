import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=await mkdtemp(join(tmpdir(),'new-album-'));
await build({entryPoints:['src/features/albums/NewAlbum.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'new.mjs'),plugins:[{name:'new-album',setup(b){
 b.onResolve({filter:/\.css$|^react(\/jsx-runtime)?$|^react-router$|^@tanstack\/react-query$|api\/client$|usePrivateRequest$|useEasyUploads$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:
  a.path.endsWith('.css')?'':
  a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:
  a.path==='react'?`export const useEffect=()=>{},useRef=v=>hooks.ref(v),useState=v=>hooks.state(v);`:
  a.path==='react-router'?`export const Link='link',useNavigate=()=>(path,options)=>env.events.push({navigate:path,options});`:
  a.path==='@tanstack/react-query'?`export const useQuery=()=>({data:{album_content_enabled:env.enabled,easy_upload:{max_photos:20}}}),useQueryClient=()=>({invalidateQueries:async()=>env.events.push('invalidate')});`:
  /usePrivateRequest$/.test(a.path)?`export const usePrivateRequest=()=>env.request;`:
  /useEasyUploads$/.test(a.path)?`export const stageNewAlbumUploads=(user,album,files)=>env.events.push({stage:{user,album,files}});`:
  `export const api=(...args)=>env.api(...args),errorText=e=>e.message;`}));
}}]});
const {NewAlbum}=await import(join(dir,'new.mjs'));
const nodes=tree=>!tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const file=new File(['example'],'memory.jpg',{type:'image/jpeg'});
function setup(){
 const cells=[],owner=crypto.randomUUID();let cursor=0;
 const events=[],request={current:new AbortController()};
 globalThis.env={events,request,enabled:true,api:async(path,options)=>{events.push({path,options});return {album:{id:'new',content_enabled:true}};}};
 globalThis.hooks={ref:value=>{const i=cursor++;return cells[i]??={current:value};},state:value=>{const i=cursor++;if(!(i in cells))cells[i]=value;return [cells[i],next=>cells[i]=typeof next==='function'?next(cells[i]):next];}};
 return {events,request,owner,render(){cursor=0;return NewAlbum({userId:owner});},choose(files){const target={files,value:'chosen'};nodes(this.render()).find(node=>node.type==='input').props.onChange({target});assert.equal(target.value,'');}};
}
test('opening, re-rendering and cancelling native selection create no album and issue no deletion',async()=>{
 const t=setup();t.render();t.render();t.choose([]);await tick();assert.deepEqual(t.events,[]);
 assert.equal(nodes(t.render()).find(node=>node.type==='link').props.to,'/albums');
});
test('confirmed files create once, transfer privately to the upload queue, and replace the empty screen',async()=>{
 const t=setup();t.choose([file]);t.choose([file]);await tick();
 const requests=t.events.filter(event=>event.path);assert.equal(requests.length,1);assert.equal(requests[0].path,'/albums');assert.equal(requests[0].options.method,'POST');assert.deepEqual(requests[0].options.body,{});
 assert.deepEqual(t.events.find(event=>event.stage).stage,{user:t.owner,album:'new',files:[file]});
 assert.deepEqual(t.events.find(event=>event.navigate),{navigate:'/albums/new/manage',options:{replace:true}});
});
test('lost create response retains chosen files and retries the identical idempotency key',async()=>{
 const t=setup();env.api=async(path,options)=>{t.events.push({path,options});throw Error('연결 끊김');};t.choose([file]);await tick();
 const tree=t.render();assert.ok(nodes(tree).some(node=>node.props?.role==='alert'));
 env.api=async(path,options)=>{t.events.push({path,options});return {album:{id:'replayed',content_enabled:true}};};
 nodes(tree).find(node=>node.type==='button'&&node.props.children==='다시 시도').props.onClick();await tick();
 const requests=t.events.filter(event=>event.path);assert.equal(requests.length,2);assert.equal(requests[0].options.key,requests[1].options.key);assert.deepEqual(t.events.find(event=>event.stage).stage.files,[file]);
});
test('logout or leaving during create does not hand private files to a late response or navigate',async()=>{
 const t=setup();let resolve;env.api=()=>new Promise(done=>resolve=done);t.choose([file]);t.request.current.abort();resolve({album:{id:'late',content_enabled:true}});await tick();assert.deepEqual(t.events,[]);
});
test('over-limit selection creates nothing and offers selecting again',async()=>{
 const t=setup();t.choose(Array(21).fill(file));await tick();assert.deepEqual(t.events,[]);assert.ok(nodes(t.render()).some(node=>node.props?.role==='alert'));
});
test('disabled management environment does not create through the new route',()=>{
 const t=setup();env.enabled=false;assert.equal(nodes(t.render()).some(node=>node.type==='input'),false);assert.deepEqual(t.events,[]);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
