import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({stdin:{contents:`export {Bookshelf} from './src/features/albums/Bookshelf';export {DesignDetail} from './src/features/goods/Designs';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'album-access-check.mjs',external:['react','react-dom/server','react-router'],plugins:[{name:'queries',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onResolve({filter:/@tanstack\/react-query/},a=>({path:a.path,namespace:'queries'}));
 b.onLoad({filter:/.*/,namespace:'queries'},()=>({contents:`export const useInfiniteQuery=()=>globalThis.albumQuery;export const useQuery=({queryKey})=>({data:queryKey[0]==='goods-design'?globalThis.design: {goods_checkout_mode:'disabled'}});export const useQueryClient=()=>({invalidateQueries:async()=>{}});`}));
}}]});
globalThis.window=new EventTarget();window.location={origin:'http://localhost'};
const {createElement:h}=await import('react');
const {renderToStaticMarkup:render}=await import('react-dom/server');
const {MemoryRouter}=await import('react-router');
const {Bookshelf,DesignDetail}=await import('../album-access-check.mjs');
const html=C=>render(h(MemoryRouter,null,h(C,{userId:'owner'})));

test('empty bookshelf guides purchase and only links to goods creation',()=>{
 globalThis.albumQuery={data:{pages:[{items:[],media_access:[]}]}};
 const output=html(Bookshelf);
 assert.match(output,/굿즈를 구매하면 전용 사진첩/);
 assert.match(output,/href="\/goods"[^>]*>굿즈 만들기/);
 assert.doesNotMatch(output,/새 사진첩|사진첩 생성 다시 시도/);
});
test('existing albums remain reachable without restoring independent creation',()=>{
 globalThis.albumQuery={data:{pages:[{items:[{id:'legacy',title:'기존 추억',status:'draft',page_count:0,updated_at:'2026-10-20T00:00:00Z'}],media_access:[]}]}};
 const output=html(Bookshelf);
 assert.match(output,/기존 추억/);assert.match(output,/href="\/albums\/legacy\/edit"/);
 assert.match(output,/사진첩 삭제/);assert.doesNotMatch(output,/새 사진첩/);
});
test('checkout disabled does not restore manual connection or free album creation',()=>{
 globalThis.design={id:'design',version:1,product:'magnet',image_url:'/art.png',placement:{holeX:.5,holeY:0,widthMm:50}};
 const output=html(DesignDetail);
 assert.doesNotMatch(output,/새 앨범 만들기|기존 앨범 연결|완성한 앨범을 선택/);
});
test.after(()=>unlink('album-access-check.mjs'));
