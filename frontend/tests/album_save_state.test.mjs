import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'album-save-state-'));
await build({entryPoints:['src/features/content/AlbumUploadActivity.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:join(dir,'activity.mjs'),plugins:[{name:'hooks',setup(b){
 b.onResolve({filter:/^(react|react\/jsx-runtime)$|UploadPhoto$/},a=>({path:a.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react'?`export const useState=v=>hooks.state(v),useRef=v=>hooks.ref(v),useEffect=(f,d)=>hooks.effect(f,d);`:`export const UploadPhoto='photo';`}));
}}]});
const {AlbumSaveState,AlbumUploadActivity}=await import(join(dir,'activity.mjs'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
const text=t=>t==null||typeof t==='boolean'?'':typeof t!=='object'?String(t):Array.isArray(t)?t.map(text).join(''):text(t.props?.children);
const page=(id,status='ready',caption='기억')=>({id,upload_status:status,caption_text:caption,caption_status:caption===null?'queued':'ready'});
const item=(id,state='saved')=>({id,pageId:id,state});
const upload=(items=[],busy=false,activeIds=[])=>({items,busy,activeIds,error:''});
function harness(){
 const cells=[],jobs=[];let cursor=0,changed=false;
 const hooks={state(value){const i=cursor++;if(!(i in cells))cells[i]=value;return [cells[i],next=>{const v=typeof next==='function'?next(cells[i]):next;if(!Object.is(v,cells[i])){cells[i]=v;changed=true;}}];},ref(value){const i=cursor++;return cells[i]??={current:value};},effect(f,deps){const i=cursor++,old=cells[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){old?.cleanup?.();const cell={deps};cells[i]=cell;jobs.push(()=>cell.cleanup=f());}}};
 return {render(props){let tree;do{changed=false;cursor=0;globalThis.hooks=hooks;tree=AlbumUploadActivity(props);while(jobs.length)jobs.shift()();}while(changed);return tree;},close(){for(const c of cells)c?.cleanup?.();}};
}
test('quiet footer confirms only stored photos, including a verified upload before gallery refresh',()=>{
 assert.equal(text(AlbumSaveState({upload:upload(),pages:[]})),'');
 assert.equal(text(AlbumSaveState({upload:upload([item('new')]),pages:[page('old')]})),'사진 2장 저장 완료');
 assert.equal(text(AlbumSaveState({upload:upload([item('new')]),pages:[page('old'),page('new','validating')]})),'사진 2장 저장 완료');
 assert.equal(text(AlbumSaveState({upload:upload([item('new')]),pages:[page('old'),page('new')]})),'사진 2장 저장 완료');
 assert.match(text(AlbumSaveState({upload:upload(),pages:[page('old','ready',null)]})),/저장 완료 · 글귀 준비 중/);
});
test('pending, rejected, and replaced photos cannot imply everything is stored',()=>{
 for(const u of [upload([item('pending','failed')]),{...upload(),error:'연결 실패'}])assert.match(text(AlbumSaveState({upload:u,pages:[page('old')]})),/확인 필요/);
 assert.match(text(AlbumSaveState({upload:upload(),pages:[page('old'),page('bad','rejected')]})),/사진 1장 저장 · 확인 필요/);
 assert.match(text(AlbumSaveState({upload:upload([],true),pages:[page('old')]})),/저장하고 있어요/);
 assert.equal(text(AlbumSaveState({upload:upload([{...item('replacement'),replacesPageId:'old'}]),pages:[page('old')]})),'사진 1장 저장 완료');
});
test('completion toast expires at six seconds while the quiet footer remains available',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness(),items=[item('new','checking')];
 h.render({upload:upload(items,true,['new']),pages:[],max:50});items[0].state='saved';
 const props={upload:upload(items),pages:[page('new','ready',null)],max:50};
 assert.match(text(h.render(props)),/사진 1장을 저장했어요/);
 assert.match(text(h.render(props)),/이제 나가도 괜찮아요. 글귀는 계속 준비해요/);
 assert.doesNotMatch(text(h.render({...props,canLeave:false})),/나가도 괜찮/);
 t.mock.timers.tick(5999);assert.ok(nodes(h.render(props)).some(n=>n.props?.className==='content-toast'));
 t.mock.timers.tick(1);assert.ok(!nodes(h.render(props)).some(n=>n.props?.className==='content-toast'));
 assert.match(text(AlbumSaveState(props)),/사진 1장 저장 완료/);h.close();
});
test('partial or unrelated failures never show the safe-to-leave confirmation',()=>{
 for(const unrelated of [false,true]){
  const h=harness(),items=[item('good','checking'),item('bad','failed')];
  h.render({upload:upload(items,true,unrelated?['good']:['good','bad']),pages:[],max:50});items[0].state='saved';
  const tree=h.render({upload:upload(items),pages:[page('good')],max:50});
  assert.match(text(tree),/사진 1장 저장 · 확인 필요/);assert.doesNotMatch(text(tree),/나가도 괜찮/);h.close();
 }
});
test.after(()=>rm(dir,{recursive:true,force:true}));
