import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'easy-optimize-'));
await build({entryPoints:['src/features/uploads/optimizePhoto.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'optimize.mjs')});
await build({entryPoints:['src/features/uploads/photoDecoder.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'decoder.mjs')});
const {optimizePhoto}=await import(join(dir,'optimize.mjs'));
const {photoTask}=await import(join(dir,'decoder.mjs'));
const photo=()=>new File([new Uint8Array([255,216,255,192,0,17,8,7,208,23,112,3,1,17,0,2,17,0,3,17,0,255,218,0,2,...new Array(200).fill(0)])],'wide.jpg',{type:'image/jpeg',lastModified:123});
function browser(){
 const stats={decoded:0,closed:0,active:0,peak:0,canvas:[],failFirst:false,failAll:false,holdEncode:false,encoding:false};
 globalThis.createImageBitmap=async()=>{stats.decoded++;if(stats.failAll||stats.failFirst&&stats.decoded===1)throw Error('memory pressure');stats.active++;stats.peak=Math.max(stats.peak,stats.active);return {width:6000,height:2000,close(){stats.closed++;stats.active--;}};};
 globalThis.Image=class{set src(value){this.value=value;if(value)queueMicrotask(()=>{this.naturalWidth=4000;this.naturalHeight=3000;stats.failAll?this.onerror?.():this.onload?.();});}removeAttribute(){this.value='';}};
 globalThis.document={createElement(){const surface={width:0,height:0,getContext:()=>({transform(){},drawImage(){}}),toBlob(callback,type){stats.encoding=true;if(stats.holdEncode)return;const bytes=new Uint8Array(48);bytes.set([82,73,70,70,40,0,0,0,87,69,66,80]);callback(new Blob([bytes],{type}));}};stats.canvas.push(surface);return surface;}};
 return stats;
}
test('transient decode failure is retried locally; only an optimized landscape WebP is returned',async()=>{
 const stats=browser();stats.failFirst=true;const original=photo(),out=await optimizePhoto(original,new AbortController().signal);
 assert.equal(stats.decoded,2);assert.equal(stats.closed,1);assert.equal(out.file.type,'image/webp');assert.notEqual(out.file,original);assert.equal(out.file.lastModified,123);
 assert.equal(out.preprocessing.original_width,6000);assert.equal(out.preprocessing.original_height,2000);assert.equal(stats.canvas[0].width,0);
 assert.ok(out.file.size<=1_000_000);assert.ok(out.thumbnail.size<=200_000);
});
test('native image decoding handles HEIC when available, retaining its ratio and never sending original bytes',async()=>{
 const stats=browser();const original=new File(['native-heic'],'phone.heic',{type:'image/heic'}),out=await optimizePhoto(original,new AbortController().signal);
 assert.equal(stats.decoded,0);assert.equal(out.file.type,'image/webp');assert.notEqual(out.file,original);assert.equal(out.preprocessing.original_width,4000);assert.equal(out.preprocessing.original_height,3000);
});
test('permanent decoding failure retains the source as an error, with no original-file fallback',async()=>{
 const stats=browser();stats.failAll=true;
 await assert.rejects(optimizePhoto(photo(),new AbortController().signal),/사진/);
 assert.equal(stats.decoded,2);assert.equal(stats.closed,0);
});
test('unsupported animated files are retained as an error instead of silently uploading a first frame',async()=>{
 const stats=browser();
 await assert.rejects(optimizePhoto(new File(['GIF89a'],'animation.gif',{type:'image/gif'}),new AbortController().signal),/선택해 주세요/);
 assert.equal(stats.decoded,0);assert.equal(stats.canvas.length,0);
});
test('abort during encoding releases the decoder and canvas without returning a prepared photo',async()=>{
 const stats=browser();stats.holdEncode=true;const controller=new AbortController();
 const job=optimizePhoto(photo(),controller.signal);
 while(!stats.encoding)await new Promise(resolve=>setTimeout(resolve,0));controller.abort();
 await assert.rejects(job,{name:'AbortError'});assert.equal(stats.closed,1);assert.ok(stats.canvas.every(surface=>surface.width===0&&surface.height===0));
});
test('preview and preparation share one decode lane; preparation has priority over waiting previews',async()=>{
 const controller=new AbortController(),order=[];let release;
 const first=photoTask(()=>new Promise(resolve=>{release=()=>{order.push('first');resolve();};}),controller.signal,0);
 const preview=photoTask(async()=>{order.push('preview');},controller.signal,0);
 const optimized=photoTask(async()=>{order.push('optimized');},controller.signal,1);
 release();await Promise.all([first,preview,optimized]);assert.deepEqual(order,['first','optimized','preview']);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
