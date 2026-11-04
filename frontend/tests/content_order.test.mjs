import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'content-order-'));
await build({entryPoints:['src/features/content/ContentManager.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'manager.mjs'),plugins:[{name:'contract-harness',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$|api\/client$|useEasyUploads$|useCaptionEdits$|usePhotoReorder$|usePhotoOrder$|UploadPhoto$|UploadInspector$|AlbumUploadActivity$|AlbumTitle$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:
 a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";`:
 a.path==='react'?`export const useEffect=()=>{},useRef=v=>({current:v}),useState=v=>{const i=globalThis.cursor++;if(!(i in globalThis.cells))cells[i]=v;return [cells[i],n=>cells[i]=typeof n==='function'?n(cells[i]):n];};`:
 a.path==='react-router'?`export const Link='link',useNavigate=()=>()=>{},useParams=()=>({albumId:'album'});`:
 a.path==='@tanstack/react-query'?`export const useQuery=o=>o.queryKey[0]==='client-config'?{data:{album_content_enabled:true,...(globalThis.capacity===undefined?{}:{easy_upload:{max_photos:globalThis.capacity}})}}:globalThis.query;export const useQueryClient=()=>({invalidateQueries:async()=>globalThis.events.push('invalidate')});`:
 /api\/client$/.test(a.path)?`export const api=async(path,options={})=>{events.push({path,...options});return globalThis.query.data;},errorText=e=>e.message;`:
 /useEasyUploads$/.test(a.path)?`export const hasUploadDraft=()=>false,useEasyUploads=(_album,_user,_refresh,max)=>{globalThis.uploadLimit=max;return globalThis.upload;};`:
 /useCaptionEdits$/.test(a.path)?`export const useCaptionEdits=()=>globalThis.edits;`:
 /usePhotoReorder$/.test(a.path)?`export const usePhotoReorder=()=>({stop(){},interacting:false,dragging:false});`:
 /usePhotoOrder$/.test(a.path)?`export const usePhotoOrder=o=>({pages:o.pages,busy:false,error:'',message:'',dismiss(){},move:async()=>true});`:
 `export const UploadPhoto='photo',UploadInspector='inspector',AlbumUploadActivity='activity',AlbumSaveState='save-state',PhotoAddButton='add',AlbumTitle='album-title';`}));
}}]});
const {ContentManager}=await import(join(dir,'manager.mjs'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function reset(mode='manual',state='ready'){
 globalThis.cells=[];globalThis.events=[];globalThis.flushOK=true;globalThis.capacity=50;
 globalThis.upload={items:[],busy:false,error:'',replace:async()=>events.push('replace')};
 globalThis.edits={drafts:{},dirty:false,saving:0,change(id,text){this.drafts[id]={text};this.dirty=true;},save:async()=>{},flush:async()=>{events.push('flush');return globalThis.flushOK;}};
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
  await edit();assert.ok(nodes(render()).some(n=>n.type==='button'&&n.props.children==='완료'));
 }
});
const finish=()=>nodes(render()).find(n=>n.type==='button'&&n.props.className==='content-finish');
const caption=()=>nodes(render()).find(n=>n.type==='textarea');
test('the edit-session label survives autosave and resets only when editing opens again',async()=>{
 reset();await edit();assert.equal(finish().props.children,'완료');
 caption().props.onChange({target:{value:'새로운 글귀'}});assert.equal(finish().props.children,'저장하고 완료');
 edits.dirty=false;edits.saving=0;assert.equal(finish().props.children,'저장하고 완료');
 finish().props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(caption(),undefined);
 await edit();assert.equal(finish().props.children,'완료');
});
test('failed flush preserves editing and text; finishing disables repeated actions until success',async()=>{
 reset();await edit();caption().props.onChange({target:{value:'보존할 입력'}});globalThis.flushOK=false;
 finish().props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(edits.drafts.one.text,'보존할 입력');assert.ok(caption());assert.equal(finish().props.children,'저장하고 완료');
 let resolve;edits.flush=()=>new Promise(r=>resolve=r);finish().props.onClick();
 assert.equal(finish().props.disabled,true);assert.equal(finish().props.children,'저장 중…');
 resolve(true);await new Promise(r=>setImmediate(r));assert.equal(caption(),undefined);
});
test('confirmed photo changes keep the session label and a failed replacement prevents closing',async()=>{
 reset();await edit();sort().props.onChange({target:{value:'date'}});await new Promise(r=>setImmediate(r));
 assert.equal(finish().props.children,'저장하고 완료');
 reset();await edit();const replace=nodes(render()).find(n=>n.type==='input'&&n.props.type==='file');
 replace.props.onChange({target:{files:[{}],value:'photo'}});await new Promise(r=>setImmediate(r));
 assert.ok(events.includes('replace'));assert.equal(finish().props.children,'저장하고 완료');
 upload.items=[{id:'retry',replacesPageId:'one',state:'failed'}];finish().props.onClick();await new Promise(r=>setImmediate(r));
 assert.ok(caption());assert.ok(nodes(render()).some(n=>n.props?.role==='alert'&&/사진 교체가 아직/.test(n.props.children)));
});
test.after(()=>rm(dir,{recursive:true,force:true}));
