import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'album-home-'));
await build({entryPoints:['src/features/albums/Bookshelf.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'home.mjs'),plugins:[{name:'home',setup(b){
 b.onResolve({filter:/\.css$|^react(\/jsx-runtime)?$|^react-router$|^@tanstack\/react-query$|api\/client$|usePrivateRequest$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('.css')?'':a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react'?`export const useEffect=()=>{},useRef=v=>h.ref(v),useState=v=>h.state(v);`:a.path==='react-router'?`export const Link='link',useLocation=()=>({}),useNavigate=()=>path=>env.events.push({navigate:path});`:a.path==='@tanstack/react-query'?`export const useQuery=()=>({data:{album_content_enabled:env.enabled!==false}}),useInfiniteQuery=()=>({data:{pages:[{items:env.albums??[],media_access:[]}]}}),useQueryClient=()=>({invalidateQueries:async()=>env.events.push('invalidate')});`:/usePrivateRequest$/.test(a.path)?`export const usePrivateRequest=()=>env.request;`:`export const api=(...args)=>env.api(...args),errorText=e=>e.message;`}));
}}]});
const {Bookshelf}=await import(join(dir,'home.mjs'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function setup(){let index=0;const cells=[],events=[],request={current:new AbortController()};globalThis.env={events,request,api:async(path,options)=>{events.push({path,options});return {album:{id:'created',status:'draft',content_enabled:true,page_count:0}};}};globalThis.h={ref:v=>{const i=index++;return cells[i]??={current:v};},state:v=>{const i=index++;if(!(i in cells))cells[i]=v;return [cells[i],n=>cells[i]=typeof n==='function'?n(cells[i]):n];}};return {events,request,render(){index=0;return Bookshelf({userId:crypto.randomUUID()});},ownerRender(owner){index=0;return Bookshelf({userId:owner});}};}
const button=tree=>nodes(tree).find(n=>n.type==='button'&&n.props.children==='첫 앨범 만들기');
const tick=()=>new Promise(r=>setImmediate(r));
test('new album opens the upload screen without creating a server album',async()=>{
 const t=setup(),owner=crypto.randomUUID();button(t.ownerRender(owner)).props.onClick();await tick();assert.deepEqual(t.events,[{navigate:'/albums/new'}]);
});
test('double activation creates one request and a lost response retries the same key',async()=>{
 const t=setup(),owner=crypto.randomUUID();env.enabled=false;let reject;env.api=(path,options)=>{t.events.push({path,options});return new Promise((_r,j)=>reject=j);};
 const action=button(t.ownerRender(owner));action.props.onClick();action.props.onClick();assert.equal(t.events.length,1);reject(Error('연결 끊김'));await tick();
 env.api=async(path,options)=>{t.events.push({path,options});return {album:{id:'same',content_enabled:true}};};button(t.ownerRender(owner)).props.onClick();await tick();assert.equal(t.events[0].options.key,t.events[1].options.key);assert.ok(t.events.some(e=>e.navigate==='/albums/same/manage'));
});
test('logout while creating prevents a late response from navigating or updating private lists',async()=>{
 const t=setup();env.enabled=false;let resolve;env.api=()=>new Promise(r=>resolve=r);button(t.render()).props.onClick();t.request.current.abort();resolve({album:{id:'late',content_enabled:true}});await tick();assert.deepEqual(t.events,[]);
});
test('ready album cover opens the book while its secondary link opens photo management',()=>{
 const t=setup();env.albums=[{id:'ready',title:'추억',page_count:3,status:'draft',content_enabled:true,content_ready:true}];
 const tree=t.render(),card=nodes(tree).find(node=>node.props?.destination);
 assert.equal(card.props.destination,'/albums/ready/view');
 const manage=nodes(card.props.menu).find(node=>node.type==='link');assert.equal(manage.props.to,'/albums/ready/manage');assert.match(manage.props['aria-label'],/앨범 관리/);assert.equal(nodes(tree).some(node=>node.type==='details'),false);
});
test('empty and unprepared albums never open an empty viewer; published legacy books still open normally',()=>{
 for(const [album,destination,enabled=true] of [
  [{id:'empty',page_count:0,status:'published',content_enabled:true,content_ready:true},'/albums/empty/manage'],
  [{id:'pending',page_count:2,status:'draft',content_enabled:true,content_ready:false},'/albums/pending/manage'],
  [{id:'legacy',page_count:2,status:'published'},'/albums/legacy/view',false],
 ]){
  const t=setup();env.enabled=enabled;env.albums=[{title:'추억',...album}];const card=nodes(t.render()).find(node=>node.props?.destination);assert.equal(card.props.destination,destination);
  if(album.id==='legacy')assert.equal(nodes(card.props.menu).find(node=>node.type==='link').props.to,'/albums/legacy/review');
 }
});
test.after(()=>rm(dir,{recursive:true,force:true}));
