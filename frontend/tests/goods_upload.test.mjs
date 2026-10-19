import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({stdin:{contents:`export * from './src/features/goods/api'; export * from './src/features/goods/preprocess';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'goods-upload-check.mjs'});
const m=await import('../goods-upload-check.mjs');
const signal=()=>new AbortController().signal;
function jpeg(w=6000,h=4000,orientation=1){
 const exif=new Uint8Array(32),d=new DataView(exif.buffer);exif.set([69,120,105,102,0,0,73,73,42,0,8,0,0,0]);d.setUint16(14,1,true);d.setUint16(16,274,true);d.setUint16(18,3,true);d.setUint32(20,1,true);d.setUint16(24,orientation,true);
 return new File([new Uint8Array([255,216,255,225,0,34,...exif,255,192,0,17,8,h>>8,h&255,w>>8,w&255,3,1,17,0,2,17,0,3,17,0,255,218,0,2]),new Uint8Array(2000)],'photo.jpg',{type:'image/jpeg'});
}
function browser(){
 const state={closed:0,decodes:[],surfaces:[],draws:[]};
 globalThis.window={location:{origin:'https://mori.test'},dispatchEvent(e){state.event=e.type;}};
 globalThis.createImageBitmap=async(blob,opts)=>{state.decodes.push(opts);return {width:opts.resizeWidth,height:opts.resizeHeight,close(){state.closed++;}};};
 globalThis.document={createElement(){const c={width:0,height:0,getContext(){return {transform(...args){state.matrix=args;},drawImage(...args){state.draws.push([c.width,c.height,...args.slice(1)]);}};},toBlob(cb,type,q){state.quality=q;cb(new Blob([new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80])],{type}));}};state.surfaces.push(c);return c;}};
 return state;
}
test('high resolution JPEG uses bounded resized decode, 85 WebP and releases surfaces',async()=>{
 const s=browser(),f=jpeg();const out=await m.prepareGoodsSource(f,signal());assert.notEqual(out,f);assert.equal(out.type,'image/webp');assert.deepEqual(s.decodes[0],{resizeWidth:2048,resizeHeight:1365,resizeQuality:'high'});assert.equal(s.quality,.85);assert.equal(s.closed,1);assert.ok(s.surfaces.every(c=>!c.width&&!c.height));
});
test('all EXIF orientations apply once after stripped resized decode; small files never upscale',async()=>{
 const matrices=[[1,0,0,1,0,0],[-1,0,0,1,100,0],[-1,0,0,-1,100,50],[1,0,0,-1,0,50],[0,1,1,0,0,0],[0,1,-1,0,50,0],[0,-1,-1,0,50,100],[0,-1,1,0,0,100]];
 for(let o=1;o<=8;o++){const s=browser();await m.prepareGoodsSource(jpeg(100,50,o),signal());assert.deepEqual(s.draws[0].slice(0,2),o>=5?[50,100]:[100,50]);assert.equal(s.closed,1);assert.deepEqual(s.matrix,matrices[o-1]);}
});
test('unsupported HEIC including empty MIME and >40MP originals bypass decoder',async()=>{
 const s=browser();for(const f of [new File(['heic'],'PHOTO.HEIC'),new File(['heif'],'x.HEIF',{type:'image/heif'}),jpeg(8000,6000)]){assert.equal(await m.prepareGoodsSource(f,signal()),f);}assert.equal(s.decodes.length,0);assert.match(m.goodsSourceAccept,/\.heic/);
});
test('20MiB source bound is checked before decode even when compression might shrink it',async()=>{
 browser();await assert.rejects(m.prepareGoodsSource(new File([new Uint8Array(20*1024*1024+1)],'big.jpg',{type:'image/jpeg'}),signal()),/20/);
});
test('ignored resize options or unsupported Canvas/decoder safely return source',async()=>{
 for(const mode of ['resize','canvas','decode']){const s=browser(),f=jpeg();if(mode==='resize')globalThis.createImageBitmap=async()=>({width:6000,height:4000,close(){s.closed++;}});if(mode==='canvas')document.createElement=()=>({width:0,height:0,getContext(){return null;}});if(mode==='decode')globalThis.createImageBitmap=async()=>{throw Error('decode');};assert.equal(await m.prepareGoodsSource(f,signal()),f);}
});
test('abort after decode propagates and closes bitmap',async()=>{
 const s=browser(),c=new AbortController(),decode=createImageBitmap;globalThis.createImageBitmap=async(...args)=>{const b=await decode(...args);c.abort();return b;};await assert.rejects(m.prepareGoodsSource(jpeg(),c.signal),{name:'AbortError'});assert.equal(s.closed,1);
});
test('upload preserves server envelope and unauthorized notification',async()=>{
 const s=browser();globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'AUTH_REQUIRED',details:{reason:'expired'},retryable:false},request_id:'request-1'}),{status:401});await assert.rejects(m.uploadSource('w',jpeg(),signal()),e=>e.status===401&&e.code==='AUTH_REQUIRED'&&e.requestId==='request-1'&&e.details.reason==='expired'&&!e.retryable);assert.equal(s.event,'mori:unauthorized');
});
test('binary proxy errors keep HTTP status and source request uses owner authenticated no-store',async()=>{
 browser();globalThis.fetch=async()=>new Response('gateway',{status:503});await assert.rejects(m.uploadSource('w',jpeg()),e=>e.status===503&&e.code==='HTTP_ERROR');let request;
 globalThis.fetch=async(url,options)=>{request={url,...options};return new Response(new Blob(['webp'],{type:'image/webp'}));};globalThis.Image=class{set src(v){queueMicrotask(()=>this.onload?.());}};const url=await m.loadSourcePreview('w',signal());assert.equal(request.url,'/api/v1/goods/work/w/source');assert.equal(request.credentials,'same-origin');assert.equal(request.cache,'no-store');assert.match(url,/^blob:/);URL.revokeObjectURL(url);
});
test('failed or cancelled normalized preview revokes candidate URL',async()=>{
 browser();globalThis.fetch=async()=>new Response(new Blob(['webp'],{type:'image/webp'}));const create=URL.createObjectURL,revoke=URL.revokeObjectURL,urls=[];URL.revokeObjectURL=url=>{urls.push(url);revoke(url);};
 try{globalThis.Image=class{set src(v){queueMicrotask(()=>this.onerror?.());}};await assert.rejects(m.loadSourcePreview('w',signal()),/미리보기/);assert.equal(urls.length,1);
 const c=new AbortController();globalThis.Image=class{set src(v){if(v)queueMicrotask(()=>c.abort());}};await assert.rejects(m.loadSourcePreview('w',c.signal),{name:'AbortError'});assert.equal(urls.length,2);
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;}
});
test('candidate HTTP/network/preview failures never discard existing work',async()=>{
 await build({entryPoints:['src/features/goods/workflow.ts'],bundle:true,platform:'node',format:'esm',outfile:'goods-upload-workflow-check.mjs'});const {replacePhoto}=await import('../goods-upload-workflow-check.mjs');
 for(const status of [401,403,422,503,0,200]){
  browser();let deleted=false;
  globalThis.fetch=async()=>{if(status===0)throw TypeError('offline');return new Response(status===200?'webp':JSON.stringify({error:{code:'IMAGE_DECODE_FAILED'}}),{status});};globalThis.Image=class{set src(v){queueMicrotask(()=>this.onerror?.());}};
  await assert.rejects(replacePhoto(true,()=>true,async()=>{await m.uploadSource('new',jpeg(),signal());const source=await m.loadSourcePreview('new',signal());return {work:'new',source};},async()=>{deleted=true;}));assert.equal(deleted,false);
 }
});
function png(w,h,extra=[]){const chunk=(name,data)=>{const b=new Uint8Array(data.length+12);new DataView(b.buffer).setUint32(0,data.length);b.set(new TextEncoder().encode(name),4);b.set(data,8);return b;};const ihdr=new Uint8Array(13),d=new DataView(ihdr.buffer);d.setUint32(0,w);d.setUint32(4,h);ihdr[8]=8;ihdr[9]=6;return new File([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...extra.map(([n,v])=>chunk(n,v)),chunk('IDAT',new Uint8Array(200)),chunk('IEND',[])],'x.png',{type:'image/png'});}
function webp(w,h){const b=new Uint8Array(120),d=new DataView(b.buffer);b.set(new TextEncoder().encode('RIFF'));d.setUint32(4,112,true);b.set(new TextEncoder().encode('WEBPVP8 '),8);d.setUint32(16,100,true);b.set([157,1,42],23);d.setUint16(26,w,true);d.setUint16(28,h,true);return new File([b],'x.webp',{type:'image/webp'});}
test('safe PNG and basic WebP resize; high-resolution or color metadata falls back before decode',async()=>{
 for(const f of [png(100,50),webp(100,50)]){const s=browser();assert.notEqual(await m.prepareGoodsSource(f,signal()),f);assert.deepEqual(s.draws[0].slice(0,2),[100,50]);}
 const unsafeJpeg=new File([new Uint8Array([255,216,255,226,0,4,1,2]),jpeg().slice(2)],'icc.jpg',{type:'image/jpeg'});
 for(const f of [png(4000,4000),webp(4000,4000),png(100,50,[['iCCP',[1]]]),png(100,50,[['cICP',[1]]]),unsafeJpeg]){const s=browser();assert.equal(await m.prepareGoodsSource(f,signal()),f);assert.equal(s.decodes.length,0);}
});
test('abort in encoder clears canvas; no bitmap API or wrong encoder preserves original',async()=>{
 const s=browser(),c=new AbortController(),make=document.createElement;document.createElement=()=>{const canvas=make(),encode=canvas.toBlob;canvas.toBlob=(...a)=>{c.abort();encode(...a);};return canvas;};await assert.rejects(m.prepareGoodsSource(jpeg(),c.signal),{name:'AbortError'});assert.equal(s.closed,1);assert.ok(s.surfaces.every(c=>!c.width&&!c.height));
 for(const mode of ['bitmap','encoder']){browser();if(mode==='bitmap')delete globalThis.createImageBitmap;else document.createElement=()=>({width:0,height:0,getContext(){return {transform(){},drawImage(){}};},toBlob(cb){cb(new Blob(['PNG'],{type:'image/png'}));}});const f=jpeg();assert.equal(await m.prepareGoodsSource(f,signal()),f);}
});
test('server error categories retain details and retry guidance without flattening status',async()=>{
 for(const [status,code,message] of [[413,'IMAGE_SIZE_LIMIT_EXCEEDED',/용량/],[415,'UNSUPPORTED_MEDIA',/형식/],[422,'IMAGE_PIXEL_LIMIT_EXCEEDED',/해상도/],[422,'IMAGE_DECODE_FAILED',/읽을/],[422,'IMAGE_NORMALIZATION_FAILED',/색상/],[503,'IMAGE_PROCESS_MEMORY_LIMIT',/메모리/],[503,'IMAGE_PROCESS_TIMEOUT',/시간/],[503,'IMAGE_PROCESS_BUSY',/다른 사진/],[403,'CONSENT_REQUIRED',/동의/],[500,'INTERNAL_ERROR',/서버/]]){browser();globalThis.fetch=async()=>new Response(JSON.stringify({error:{code,details:{why:'fixture'},retryable:status===503},request_id:'r'}),{status});await assert.rejects(m.uploadSource('w',jpeg()),e=>e.status===status&&e.code===code&&e.requestId==='r'&&e.details.why==='fixture'&&e.retryable===(status===503)&&message.test(e.message));}
});
test('upload abort signal reaches fetch and is not converted into generic error',async()=>{
 browser();const c=new AbortController();globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));const result=m.uploadSource('w',jpeg(),c.signal);c.abort();await assert.rejects(result,{name:'AbortError'});
});
