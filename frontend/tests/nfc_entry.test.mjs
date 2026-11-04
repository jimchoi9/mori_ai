import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/entry.ts'],bundle:true,platform:'node',format:'esm',outfile:'nfc-entry-check.mjs'});
const {captureEntry,retainEntry,rememberEntry}=await import('../nfc-entry-check.mjs');
const first={id:'11111111-1111-4111-8111-111111111111',key:'k'.repeat(43)},second={id:'22222222-2222-4222-8222-222222222222',key:'v'.repeat(43)};
function setup(){const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};globalThis.location={pathname:'/nfc/view',hash:''};return values;}
test('a complete link stays bookmarkable and reloadable even when browser storage is unavailable',()=>{
 setup();globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 location={pathname:`/nfc/${first.id}`,hash:`#key=${first.key}`};assert.deepEqual(captureEntry(),first);
 let path;globalThis.history={state:null,replaceState:(_s,_t,url)=>path=url};retainEntry(first);assert.equal(path,`/nfc/${first.id}#key=${first.key}`);
 assert.doesNotThrow(()=>rememberEntry(first));const url=new URL(path,'https://reader.test');location={pathname:url.pathname,hash:url.hash};assert.deepEqual(captureEntry(),first);
});
test('server-accepted entries reopen later and explicit book addresses never switch to a different saved book',()=>{
 const values=setup();rememberEntry(first);rememberEntry(second);assert.deepEqual(captureEntry(),second);
 location.pathname=`/nfc/${first.id}`;assert.deepEqual(captureEntry(),first);
 location.pathname='/nfc/33333333-3333-4333-8333-333333333333';assert.equal(captureEntry(),null);
 assert.equal([...values.keys()].some(k=>k.includes('session_token')),false);
});
test('an explicit invalid key never falls back to a previously stored valid key',()=>{
 setup();rememberEntry(first);location={pathname:`/nfc/${first.id}`,hash:'#key=bad'};assert.equal(captureEntry(),null);
 location={pathname:'/goods',hash:`#key=${first.key}`};assert.equal(captureEntry(),null);
});
test('malformed saved data and unsupported routes cannot open or persist a book',()=>{
 const values=setup();values.set('mori:nfc-last-book',first.id);values.set('mori:nfc-book:'+first.id,'{invalid');assert.equal(captureEntry(),null);
 rememberEntry({id:first.id,key:'short'});assert.equal(values.get('mori:nfc-book:'+first.id),'{invalid');
 location.pathname='/nfc/other';assert.equal(captureEntry(),null);
});
test.after(()=>unlink('nfc-entry-check.mjs'));
