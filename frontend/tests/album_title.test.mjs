import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'album-title-'));
await build({entryPoints:['src/features/albums/AlbumTitle.tsx','src/features/albums/albumMeta.ts'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outdir:dir,plugins:[{name:'harness',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'css'}));b.onLoad({filter:/.*/,namespace:'css'},()=>({contents:''}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|@tanstack\/react-query)$|api\/client$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react'?`export const useEffect=()=>{},useRef=()=>({current:null}),useState=v=>{const i=globalThis.cursor++;if(!(i in globalThis.cells))cells[i]=v;return [cells[i],n=>cells[i]=typeof n==='function'?n(cells[i]):n];};`:a.path==='@tanstack/react-query'?`export const useQueryClient=()=>({invalidateQueries:async()=>events.push('invalidate')});`:`export class ApiError extends Error{constructor(code){super(code);this.code=code;}};export const errorText=e=>e.message,api=async(path,options={})=>{events.push({path,...options});if(globalThis.conflict&&options.method){globalThis.conflict=false;throw new ApiError('VERSION_CONFLICT');}return {detail:{album:{version:9,title:'다른 제목'}}};};`}));
}}]});
const {AlbumTitle}=await import(join(dir,'AlbumTitle.js'));
const {albumMeta}=await import(join(dir,'albumMeta.js'));
const nodes=t=>!t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];
function init(){globalThis.cells=[];globalThis.events=[];globalThis.conflict=false;}
let album={id:'album',title:'기장 나들이',version:7};
function render(){globalThis.cursor=0;return AlbumTitle({album,userId:'owner'});}
function find(type,predicate=()=>true){return nodes(render()).find(n=>n.type===type&&predicate(n.props));}
function open(){find('button',p=>p['aria-label']).props.onClick();}
function type(text){find('input').props.onChange({target:{value:text}});}
async function save(){await find('form').props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));}
test('capture period stays separate and missing dates show only photo count',()=>{
 assert.equal(albumMeta({page_count:50,capture_period:{start:'2026-12-31',end:'2027-01-02'}}),'2026.12.31–2027.01.02 · 사진 50장');
 assert.equal(albumMeta({page_count:3,capture_period:{start:'2026-10-11',end:'2026-10-11'}}),'2026.10.11 · 사진 3장');
 assert.equal(albumMeta({page_count:1,capture_period:null}),'사진 1장');
});
test('title text is not a rename target; only the separate edit button opens the dialog',()=>{
 init();const title=find('h1'),text=nodes(title).find(n=>n.type==='span');
 assert.equal(title.props.onClick,undefined);assert.equal(text.props.onClick,undefined);assert.equal(text.props.children,album.title);
 assert.equal(nodes(title).filter(n=>n.type==='button').length,1);assert.equal(find('form'),undefined);
 open();assert.ok(find('form'));
});
test('explicit rename cancellation sends no mutation',()=>{
 init();open();type('기장 여행');find('button',p=>p.children==='취소').props.onClick();assert.equal(find('form'),undefined);assert.deepEqual(events,[]);
});
test('background title updates do not erase typing; save uses captured revision',async()=>{
 init();open();type('  기장 여행  ');album={...album,title:'AI가 정한 이름',version:8};assert.equal(find('input').props.value,'  기장 여행  ');await save();
 assert.deepEqual(events[0].body,{title:'기장 여행',expected_version:7});assert.equal(events.filter(e=>e==='invalidate').length,2);
});
test('conflict preserves draft for explicit retry with latest revision',async()=>{
 init();open();type('기장 여행');globalThis.conflict=true;await save();assert.equal(find('input').props.value,'기장 여행');assert.match(find('p').props.children,/다른 제목/);await save();
 assert.equal(events.filter(e=>e.method==='PATCH')[1].body.expected_version,9);
});
test('blank name never sends a request',async()=>{
 init();open();type(' ');await save();assert.equal(events.length,0);assert.equal(find('input').props.value,' ');
});
await rm(dir,{recursive:true,force:true});
