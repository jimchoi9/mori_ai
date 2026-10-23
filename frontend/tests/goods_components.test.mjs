import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
await build({stdin:{contents:`export {goodsSaveIntent,rememberGoodsSave} from './src/features/goods/guestIntent'; export {GoodsDesigner} from './src/features/goods/design/GoodsDesigner'; export {GoodsMockup} from './src/features/goods/mockup/GoodsMockup'; export {StylePicker} from './src/features/goods/design/StylePicker'; export {RevisionHistory} from './src/features/goods/design/RevisionHistory';`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',outfile:'goods-components-check.mjs'});
const {StylePicker,RevisionHistory,GoodsDesigner,GoodsMockup,goodsSaveIntent,rememberGoodsSave}=await import('../goods-components-check.mjs');
test('style selection is accessible and generating blocks a different choice',()=>{
 const html=render(h(StylePicker,{styles:[{id:'book',label:'책',hint:'오픈북'},{id:'free',label:'자유',hint:'자유형'}],product:'keyring',selected:'book',disabled:true,onSelect(){}}));
 assert.match(html,/aria-pressed="true"/);assert.match(html,/aria-pressed="false"/);
 assert.ok((html.match(/disabled=""/g)||[]).length>=2);assert.match(html,/type="button"/);
 assert.match(html,/\/goods\/examples\/keyring\/book-card.webp/);
});
test('failed and pending revisions do not expose selection actions',()=>{
 const html=render(h(RevisionHistory,{items:[{id:'a',label:'첫 시안',status:'ready',imageUrl:'/a.png'},{id:'b',label:'수정 중',status:'pending'},{id:'c',label:'실패',status:'failed'}],selectedId:'a',onSelect(){}}));
 assert.match(html,/aria-pressed="true"/);assert.equal((html.match(/<button/g)||[]).length,1);
 assert.match(html,/만드는 중/);assert.match(html,/생성하지 못했어요/);
});
test('empty conversation leaves room for the composer without invented messages',()=>{
 const html=render(h(RevisionHistory,{items:[],selectedId:null,onSelect(){}}));assert.equal(html,'');
});

test('designer begins with shape selection, before upload and hole placement',()=>{
 const html=render(h(GoodsDesigner,{styles:[{id:'book',label:'책',hint:'오픈북'}]}));
 assert.match(html,/모양을 골라 주세요/);assert.doesNotMatch(html,/type="file"/);assert.doesNotMatch(html,/<canvas/);assert.match(html,/disabled=""/);
});
test('hole placement has no range slider even when interactive',()=>{
 const html=render(h(GoodsMockup,{src:'/test.png',product:'keyring',placement:{holeX:.5,holeY:0,widthMm:50},interactive:true}));
 assert.doesNotMatch(html,/type="range"/);
});

test('conversation pairs each request with its own artwork and selection branch',()=>{
 const html=render(h(RevisionHistory,{items:[{id:'a',label:'시안 1',message:'파란 바다',status:'ready',imageUrl:'/a.png'},{id:'b',label:'시안 2',message:'조개를 더 작게',parentLabel:'시안 1',status:'ready',imageUrl:'/b.png'}],selectedId:'a',onSelect(){},onPreview(){}}));
 assert.match(html,/디자인 대화/);assert.match(html,/파란 바다/);assert.match(html,/시안 1에서 수정/);assert.match(html,/시안 2 목업 보기/);assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
});
test('example zoom is a separate labeled action, never a nested selection button',()=>{
 const html=render(h(StylePicker,{styles:[{id:'book',label:'책',hint:'오픈북'}],product:'keyring',selected:'book',onSelect(){}}));
 assert.match(html,/책 완성품 예시 크게 보기/);assert.equal((html.match(/<button/g)||[]).length,2);assert.doesNotMatch(html,/<button[^>]*>[^]*?<button[^]*?<\/button>[^]*?<\/button>/);
});

test('save intent preserves magnet choice and reads legacy intents as keyrings',()=>{
 const values=new Map();globalThis.sessionStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const value={work_id:'11111111-1111-4111-8111-111111111111',revision_id:'22222222-2222-4222-8222-222222222222',placement:{holeX:.5,holeY:0,widthMm:50}};
 rememberGoodsSave({...value,product:'magnet'});assert.equal(goodsSaveIntent().product,'magnet');
 rememberGoodsSave(value);assert.equal(goodsSaveIntent().product,'keyring');
 rememberGoodsSave({...value,product:'other'});assert.equal(goodsSaveIntent(),null);delete globalThis.sessionStorage;
});
