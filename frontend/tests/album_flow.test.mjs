import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'album-flow-'));
await build({stdin:{contents:`export {PhotoAddButton} from './src/features/content/AlbumUploadActivity';export {GiftRegistration} from './src/features/goods/GiftRegistration';export {AccountMenu} from './src/components/account/AccountMenu';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'flow.mjs'),plugins:[{name:'flow-harness',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$|api\/client$|usePrivateRequest$|GlassButton$|ScreenHeader$|UploadPhoto$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:
 a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:
 a.path==='react'?`export const useEffect=f=>effects.push(f),useRef=v=>({current:v}),useState=v=>[v,()=>{}];`:
 a.path==='react-router'?`export const Link='link',useLocation=()=>({key:'key',hash:''}),useParams=()=>({purchaseId:'gift'}),useNavigate=()=>path=>events.push({navigate:path});`:
 a.path==='@tanstack/react-query'?`export const useQuery=()=>({data:globalThis.registration}),useQueryClient=()=>({setQueryData:(_k,r)=>globalThis.registration=r,invalidateQueries:async()=>{}});`:
 /api\/client$/.test(a.path)?`export const api=async(path,options)=>{events.push({path,...options});return {status:'registered',album_id:'album',album_status:'draft'};},errorText=e=>e.message;`:
 /usePrivateRequest$/.test(a.path)?`export const usePrivateRequest=()=>({current:new AbortController()});`:
 `export const GlassButton='button',ScreenHeader='header',UploadPhoto='photo';`}));
}}]});
const {PhotoAddButton,GiftRegistration,AccountMenu}=await import(join(dir,'flow.mjs'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const tick=()=>new Promise(r=>setImmediate(r));
globalThis.sessionStorage={getItem:()=>null,removeItem:()=>{}};
function reset(){globalThis.events=[];globalThis.effects=[];globalThis.registration={status:'available',album_id:null};}
test('native picker confirmation starts only selected files immediately; cancel and over-limit do not send',async()=>{
 for(const [files,remaining,flushOK,sends] of [[['a','b'],2,true,1],[[],2,true,0],[['a','b'],1,true,0],[['a'],2,false,0]]){
  reset();const upload={select:(files,n)=>{events.push({select:files,remaining:n});return files.map(id=>({id}));},send:async ids=>events.push({send:ids})};
  const tree=PhotoAddButton({upload,remaining,disabled:false,beforeSelect:async()=>flushOK});
  nodes(tree).find(n=>n.type==='input').props.onChange({target:{files,value:'chosen'}});await tick();
  assert.equal(events.filter(e=>e.send).length,sends);if(sends)assert.deepEqual(events.at(-1).send,files);
 }
});
test('gift inspection never claims automatically; only registration button sends claim',async()=>{
 reset();const tree=GiftRegistration({userId:'owner',csrfToken:'csrf',displayName:'지민'});effects.forEach(f=>f());assert.deepEqual(events,[]);
 const button=nodes(tree).find(n=>n.type==='button');assert.equal(button.props.children,'내 앨범에 등록');button.props.onClick();await tick();
 assert.equal(events.length,1);assert.equal(events[0].path,'/goods/purchases/gift/gift/claim');
});
test('registered gifts enter album directly; claimed and deleted gifts never redirect',()=>{
 for(const status of ['registered','claimed','deleted']){
  reset();registration={status,album_id:'album',album_status:'draft'};
  GiftRegistration({userId:'owner',csrfToken:'csrf',displayName:'지민'});effects.forEach(f=>f());
  assert.deepEqual(events,status==='registered'?[{navigate:'/albums/album/edit'}]:[]);
 }
});
test('account closes on outside pointer and Escape, returning focus only for Escape',()=>{
 reset();const listeners={};globalThis.document={addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:()=>{}};
 const tree=AccountMenu({name:'사용자',goods:false,onLogout(){}});let focused=false;
 const details={open:true,contains:t=>t==='inside',querySelector:()=>({focus:()=>{focused=true;}})};tree.props.ref.current=details;const cleanup=effects.map(f=>f());
 details.open=true;listeners.pointerdown({target:'inside'});assert.equal(details.open,true);listeners.pointerdown({target:'outside'});assert.equal(details.open,false);assert.equal(focused,false);
 details.open=true;listeners.keydown({key:'Escape'});assert.equal(details.open,false);assert.equal(focused,true);
 assert.doesNotMatch(JSON.stringify(tree),/사용자님의/);cleanup.forEach(f=>f?.());
});
test.after(()=>rm(dir,{recursive:true,force:true}));
