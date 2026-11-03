import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'content-order-'));
await build({entryPoints:['src/features/content/ContentManager.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'manager.mjs'),plugins:[{name:'contract-harness',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$|api\/client$|useEasyUploads$|useCaptionEdits$|usePhotoReorder$|UploadPhoto$|UploadInspector$|AlbumUploadActivity$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:
 a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";`:
 a.path==='react'?`export const useEffect=()=>{},useRef=v=>({current:v}),useState=v=>{const i=globalThis.cursor++;if(!(i in globalThis.cells))cells[i]=v;return [cells[i],n=>cells[i]=typeof n==='function'?n(cells[i]):n];};`:
 a.path==='react-router'?`export const Link='link',useNavigate=()=>()=>{},useParams=()=>({albumId:'album'});`:
 a.path==='@tanstack/react-query'?`export const useQuery=o=>o.queryKey[0]==='client-config'?{data:{album_content_enabled:true,...(globalThis.capacity===undefined?{}:{easy_upload:{max_photos:globalThis.capacity}})}}:globalThis.query;export const useQueryClient=()=>({invalidateQueries:async()=>globalThis.events.push('invalidate')});`:
 /api\/client$/.test(a.path)?`export const api=async(path,options={})=>{events.push({path,...options});return globalThis.query.data;},errorText=e=>e.message;`:
 /useEasyUploads$/.test(a.path)?`export const hasUploadDraft=()=>false,useEasyUploads=(_album,_user,_refresh,max)=>{globalThis.uploadLimit=max;return {items:[],busy:false,error:''};};`:
 /useCaptionEdits$/.test(a.path)?`export const useCaptionEdits=()=>({drafts:{},flush:async()=>{events.push('flush');return globalThis.flushOK;}});`:
 /usePhotoReorder$/.test(a.path)?`export const usePhotoReorder=()=>({stop(){}});`:
 `export const UploadPhoto='photo',UploadInspector='inspector',AlbumUploadActivity='activity',PhotoAddButton='add';`}));
}}]});
const {ContentManager}=await import(join(dir,'manager.mjs'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function reset(mode='manual',state='ready'){
 globalThis.cells=[];globalThis.events=[];globalThis.flushOK=true;globalThis.capacity=50;
 globalThis.query={data:{media_access:[],detail:{album:{id:'album',title:'추억',version:7,content_enabled:true},order_mode:mode,pages:[{id:'one',caption_text:'직접 쓴 장소',upload_status:state}]}},refetch:async()=>events.push('refresh')};
}
function render(){globalThis.cursor=0;return ContentManager({userId:'owner'});}
async function edit(){const button=nodes(render()).find(n=>n.type==='button'&&n.props.children==='편집');await button.props.onClick();}
const sort=()=>nodes(render()).find(n=>n.type==='select'&&n.props['aria-label']==='사진 정렬');
test('sort switches explicitly after flushing captions with a fresh version',async()=>{
 reset();assert.deepEqual(events,[]);assert.equal(sort().props.value,'manual');
 sort().props.onChange({target:{value:'date'}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(events[0],'flush');assert.deepEqual(events[1],{path:'/albums/album'});
 assert.deepEqual(events[2],{path:'/albums/album/date-order',method:'POST',body:{expected_version:7}});
 assert.ok(events.includes('refresh'));assert.ok(events.includes('invalidate'));
});
test('manual option restores persisted arrangement, with no destructive page-order request',async()=>{
 reset('date');sort().props.onChange({target:{value:'manual'}});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events[2],{path:'/albums/album/manual-order',method:'POST',body:{expected_version:7}});
 assert.doesNotMatch(JSON.stringify(render()),/촬영시간이 없는 사진은 파일 수정시간/);
});
test('pending work disables sorting; unresolved captions prevent mutation',async()=>{
 reset('manual','validating');assert.equal(sort().props.disabled,true);
 reset();globalThis.flushOK=false;sort().props.onChange({target:{value:'date'}});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,['flush']);
});
test('footer keeps editing and configured capacity available',async()=>{
 for(const capacity of [50,20,undefined]){
  reset();globalThis.capacity=capacity;const tree=render(),expected=capacity??50;
  assert.equal(globalThis.uploadLimit,expected);
  assert.ok(nodes(tree).some(n=>n.type==='span'&&Array.isArray(n.props.children)&&n.props.children.join('')===`1 / ${expected}`));
  await edit();assert.ok(nodes(render()).some(n=>n.type==='button'&&n.props.children==='편집 마치기'));
 }
});
test.after(()=>rm(dir,{recursive:true,force:true}));
