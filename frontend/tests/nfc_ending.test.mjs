import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/bookEnding.ts'],bundle:true,platform:'node',format:'esm',outfile:'nfc-ending-check.mjs'});
const {createBookEnding,readBookPosition,rememberBookPosition}=await import('../nfc-ending-check.mjs');
const nodes=n=>[n,...n.children.flatMap(nodes)];
function documentStub(){
 globalThis.document={createElement(tag){const listeners={};return {tag,children:[],attrs:{},append(...items){this.children.push(...items);},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){listeners[k]=fn;},click(){listeners.click?.();}};}};
}
test('back cover renders an untrusted album title as text and the visitor library as a fixed credential-free URL',()=>{
 documentStub();let replays=0;const title='<img src=x onerror=alert(1)>',cover=createBookEnding(title,()=>replays++)('full'),all=nodes(cover);
 assert.equal(all.find(n=>n.tag==='h2').textContent,title);assert.equal(all.some(n=>n.tag==='img'),false);
 const link=all.find(n=>n.tag==='a');assert.equal(link.href,'/albums');assert.equal(link.referrerPolicy,'no-referrer');
 assert.equal(link.textContent,'내 앨범 보기 →');assert.equal(all.find(n=>n.tag==='button').type,'button');
 all.find(n=>n.tag==='button').click();assert.equal(replays,1);
});
test('landscape back cover splits title and actions without duplicating either action',()=>{
 documentStub();const ending=createBookEnding('책 이름',()=>{}),left=nodes(ending('cover')),right=nodes(ending('actions'));
 assert.equal(left.filter(n=>n.tag==='h2').length,1);assert.equal(left.filter(n=>['button','a'].includes(n.tag)).length,0);
 assert.equal(right.filter(n=>n.tag==='h2').length,0);assert.deepEqual(right.filter(n=>['button','a'].includes(n.tag)).map(n=>n.tag),['button','a']);
});
test('history remembers only a page number while retaining router state, and restores the back cover',()=>{
 globalThis.history={state:{key:'router-entry',idx:3,usr:{from:'shelf'}},replaceState(value){this.state=value;}};
 rememberBookPosition(3);assert.deepEqual(history.state,{key:'router-entry',idx:3,usr:{from:'shelf'},moriMemoryPage:3});assert.equal(readBookPosition(3),3);
 // Deleted/reordered photos cannot restore beyond the new back cover.
 assert.equal(readBookPosition(1),1);rememberBookPosition(0);assert.equal(readBookPosition(3),0);
});
test('new history entries and malformed positions start at the first photo; unavailable history never blocks reading',()=>{
 for(const value of [undefined,null,-1,1.5,'2',Infinity,NaN]){globalThis.history={state:{moriMemoryPage:value}};assert.equal(readBookPosition(3),0);}
 globalThis.history={state:null,replaceState(){throw Error('browser limit');}};assert.doesNotThrow(()=>rememberBookPosition(1));
});
test.after(()=>unlink('nfc-ending-check.mjs'));
