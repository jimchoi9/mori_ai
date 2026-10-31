import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'android-heic-'));
await build({entryPoints:['src/features/uploads/optimizePhoto.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'optimize.mjs')});
await build({entryPoints:['src/features/uploads/photoDecoder.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'decoder.mjs')});
await build({entryPoints:['src/features/uploads/heicDecoder.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'heic.mjs')});
const {optimizePhoto}=await import(join(dir,'optimize.mjs'));
const {previewPhoto}=await import(join(dir,'decoder.mjs'));
const {decodeHeic}=await import(join(dir,'heic.mjs'));
const heic=()=>new File([new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99,0,0,0,0,104,101,105,99,109,105,102,49])],'galaxy.heic',{type:'image/heic',lastModified:123});
function browser(){
 const stats={workers:0,terminated:0,closed:0,active:0,peak:0,draws:[],canvases:[],hold:false,error:false,pending:undefined};
 globalThis.Image=class{set src(value){if(value)queueMicrotask(()=>this.onerror?.());}removeAttribute(){}};
 globalThis.createImageBitmap=async()=>{throw new DOMException('The source image could not be decoded.','InvalidStateError');};
 globalThis.Worker=class{
  constructor(){stats.workers++;stats.active++;stats.peak=Math.max(stats.peak,stats.active);}
  postMessage({maxEdge}){const respond=this.onmessage;stats.pending=()=>respond?.({data:{ok:true,width:4000,height:2252,image:{width:maxEdge,height:Math.round(maxEdge*2252/4000),close(){stats.closed++;}}}});queueMicrotask(()=>{if(stats.error)this.onerror?.({});else if(!stats.hold)stats.pending();});}
  terminate(){stats.terminated++;stats.active--;}
 };
 globalThis.document={createElement(){const canvas={width:0,height:0,getContext:()=>({transform(){},drawImage(image){stats.draws.push([image.width,image.height]);}}),toBlob(callback,type){const bytes=new Uint8Array(48);bytes.set([82,73,70,70,40,0,0,0,87,69,66,80]);callback(new Blob([bytes],{type}));}};stats.canvases.push(canvas);return canvas;}};
 return stats;
}
test('Galaxy HEIC rejected by native img/bitmap is automatically prepared as WebP without changing the send flow',async()=>{
 const stats=browser(),original=heic();
 const result=await optimizePhoto(original,new AbortController().signal);
 assert.equal(result.file.type,'image/webp');assert.notEqual(result.file,original);assert.equal(result.file.lastModified,123);
 assert.equal(result.preprocessing.original_width,4000);assert.equal(result.preprocessing.original_height,2252);
 assert.equal(stats.workers,1);assert.equal(stats.terminated,1);assert.equal(stats.closed,1);
 assert.ok(stats.draws.every(([w,h])=>w===2048&&h===1153));assert.ok(stats.canvases.every(c=>c.width===0&&c.height===0));
});
test('the same automatic HEIC decoder supplies a small preview, and releases its worker and bitmap',async()=>{
 const stats=browser(),preview=await previewPhoto(heic(),new AbortController().signal);
 assert.equal(preview.type,'image/webp');assert.equal(stats.workers,1);assert.equal(stats.terminated,1);assert.equal(stats.closed,1);
 assert.deepEqual(stats.draws,[[256,144]]);
});
test('cancellation terminates a pending HEIC worker and closes a late bitmap instead of returning success',async()=>{
 const stats=browser();stats.hold=true;const controller=new AbortController();
 const pending=decodeHeic(heic(),controller.signal);controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(stats.terminated,1);
 stats.pending();assert.equal(stats.closed,1);
});
test('failure to load the HEIC worker retains the original as a failed item and never returns original bytes',async()=>{
 const stats=browser();stats.error=true;
 await assert.rejects(optimizePhoto(heic(),new AbortController().signal),/\(D1\)/);
 assert.equal(stats.workers,3);assert.equal(stats.terminated,3);assert.equal(stats.draws.length,0);
});
test('the native HEIC path stays native without creating or loading a decoder worker',async()=>{
 const stats=browser();globalThis.Image=class{naturalWidth=4000;naturalHeight=2252;set src(value){if(value)queueMicrotask(()=>this.onload?.());}removeAttribute(){}};
 const result=await optimizePhoto(heic(),new AbortController().signal);
 assert.equal(result.file.type,'image/webp');assert.equal(stats.workers,0);
});
test('non-HEIC decode failures do not load a HEIC worker',async()=>{
 const stats=browser();await assert.rejects(optimizePhoto(new File(['bad png'],'bad.png',{type:'image/png'}),new AbortController().signal),/\(D1\)/);
 assert.equal(stats.workers,0);
});
test('a stalled decoder has a hard timeout and releases its worker without returning the source',async()=>{
 const stats=browser();stats.hold=true;const original=setTimeout;let expire;
 globalThis.setTimeout=(run,ms,...args)=>{if(ms===30000){expire=run;return original(()=>{},60000);}return original(run,ms,...args);};
 try{const pending=decodeHeic(heic(),new AbortController().signal);expire();await assert.rejects(pending,/\(D1\)/);assert.equal(stats.terminated,1);stats.pending();assert.equal(stats.closed,1);}
 finally{globalThis.setTimeout=original;}
});
test('twenty HEIC preparations share one decoder lane and terminate every per-photo worker',async()=>{
 const stats=browser();const results=await Promise.all(Array.from({length:20},()=>optimizePhoto(heic(),new AbortController().signal)));
 assert.equal(results.length,20);assert.equal(stats.workers,20);assert.equal(stats.terminated,20);assert.equal(stats.closed,20);assert.equal(stats.peak,1);assert.equal(stats.active,0);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
