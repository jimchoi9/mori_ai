import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'iphone-webp-'));
let fallbackCalls=0;
globalThis.fallbackWebp=async pixels=>{fallbackCalls++;assert.equal(pixels.width,2);const bytes=new Uint8Array(48);bytes.set([82,73,70,70,40,0,0,0,87,69,66,80]);return bytes.buffer;};
async function fresh(){
 const output=join(dir,Math.random()+'.mjs');
 await build({entryPoints:['src/features/uploads/photoDecoder.ts'],bundle:true,platform:'node',format:'esm',outfile:output,plugins:[{name:'encoder',setup(b){b.onResolve({filter:/^@jsquash\/webp\/encode\.js$/},()=>({path:'encoder',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const init=async()=>{};export default (...args)=>globalThis.fallbackWebp(...args);',loader:'js'}));}}]});
 return import(output);
}
function canvas(type='image/png'){
 return {width:2,height:2,getContext:()=>({getImageData:()=>({width:2,height:2,data:new Uint8ClampedArray(16)})}),toBlob(callback){callback(new Blob([type==='image/webp'?new Uint8Array([82,73,70,70,8,0,0,0,87,69,66,80]):new Uint8Array([137,80,78,71])],{type}));}};
}
test('PNG returned for a WebP request is encoded locally instead of making every iPhone photo fail',async()=>{
 const {canvasBlob}=await fresh();fallbackCalls=0;
 const blob=await canvasBlob(canvas(),.85,new AbortController().signal);
 assert.equal(blob.type,'image/webp');assert.equal(fallbackCalls,1);
 assert.equal(new TextDecoder().decode((await blob.arrayBuffer()).slice(0,4)),'RIFF');
});
test('native WebP output keeps the fast path without loading a fallback encoder',async()=>{
 const {canvasBlob}=await fresh();fallbackCalls=0;
 const blob=await canvasBlob(canvas('image/webp'),.85,new AbortController().signal);
 assert.equal(blob.type,'image/webp');assert.equal(fallbackCalls,0);
});
test('abort never turns a cancelled photo into a late successful output',async()=>{
 const {canvasBlob}=await fresh();const controller=new AbortController();let complete;
 globalThis.fallbackWebp=()=>new Promise(resolve=>complete=resolve);
 const pending=canvasBlob(canvas(),.85,controller.signal);
 while(!complete)await new Promise(resolve=>setTimeout(resolve,0));controller.abort();complete(new ArrayBuffer(48));
 await assert.rejects(pending,{name:'AbortError'});
});
test('the installed WebAssembly codec produces a real decodable WebP without any native canvas encoder',async()=>{
 const {simd}=await import('wasm-feature-detect');const {default:encode,init}=await import('@jsquash/webp/encode.js');
 const root=new URL('../node_modules/@jsquash/webp/',import.meta.url);
 const suffix=await simd()?'_simd':'';
 await init({wasmBinary:await readFile(new URL(`codec/enc/webp_enc${suffix}.wasm`,root))});
 const pixels=new Uint8ClampedArray(64*48*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=72;pixels[i+1]=123;pixels[i+2]=84;pixels[i+3]=255;}
 const encoded=await encode({width:64,height:48,data:pixels},{quality:85});
 assert.equal(new TextDecoder().decode(encoded.slice(0,4)),'RIFF');
 const {default:decode,init:loadDecoder}=await import('@jsquash/webp/decode.js');
 await loadDecoder({wasmBinary:await readFile(new URL('codec/dec/webp_dec.wasm',root))});
 const previous=globalThis.ImageData;globalThis.ImageData=class{constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
 try{const image=await decode(encoded);assert.equal(image.width,64);assert.equal(image.height,48);assert.ok(Math.abs(image.data[0]-72)<10);assert.ok(Math.abs(image.data[1]-123)<10);}
 finally{globalThis.ImageData=previous;}
});
test.after(()=>rm(dir,{recursive:true,force:true}));
