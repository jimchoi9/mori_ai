import test from 'node:test';
import assert from 'node:assert/strict';
const {prepareFiles, inspectImage, resizeDimensions} = await import(process.argv[2]);
function jpeg(w=6000,h=2000,extra=[]) {
 const segment=(marker,body)=>[255,marker,(body.length+2)>>8,(body.length+2)&255,...body];
 return new File([new Uint8Array([255,216,...extra,...segment(192,[8,h>>8,h&255,w>>8,w&255,3,1,17,0,2,17,0,3,17,0]),255,218,0,2,...new Array(200).fill(0),255,217])],'photo.jpg',{type:'image/jpeg',lastModified:1234});
}
function exif(orientation=6) {
 const b=new Uint8Array(110);const d=new DataView(b.buffer);b.set([73,73,42,0,8,0,0,0]);
 d.setUint16(8,2,true);
 d.setUint16(10,274,true);d.setUint16(12,3,true);d.setUint32(14,1,true);d.setUint16(18,orientation,true);
 d.setUint16(22,34665,true);d.setUint16(24,4,true);d.setUint32(26,1,true);d.setUint32(30,38,true);
 d.setUint16(38,2,true);
 for(const [p,tag,count,offset] of [[40,36867,20,68],[52,36881,7,88]]) {d.setUint16(p,tag,true);d.setUint16(p+2,2,true);d.setUint32(p+4,count,true);d.setUint32(p+8,offset,true);}
 b.set(new TextEncoder().encode('2020:01:02 03:04:05\0'),68);b.set(new TextEncoder().encode('+09:00\0'),88);
 const body=[69,120,105,102,0,0,...b];return [255,225,(body.length+2)>>8,(body.length+2)&255,...body];
}
let closed, canvases, decodes, active, maxActive, encodeType, encodeSize, failDecode, onDecode;
function browser() {
 closed=0;canvases=[];decodes=0;active=0;maxActive=0;encodeType='image/webp';encodeSize=24;failDecode=false;onDecode=undefined;
 globalThis.createImageBitmap=async blob=>{decodes++; active++; maxActive=Math.max(maxActive,active);await Promise.resolve();if(failDecode){active--;throw Error('decode');} const info=inspectImage(new Uint8Array(await blob.arrayBuffer()),'image/jpeg');onDecode?.();return {width:info.width,height:info.height,close(){closed++;active--;}};};
 globalThis.document={createElement(){const canvas={width:0,height:0,getContext(){return {transform(...v){canvas.matrix=v;},drawImage(){}};},toBlob(cb,type,q){canvas.quality=q;const b=new Uint8Array(encodeSize);b.set([82,73,70,70,16,0,0,0,87,69,66,80]);cb(new Blob([b],{type:encodeType}));}};canvases.push(canvas);return canvas;}};
}
const signal=()=>new AbortController().signal;
test('resize bounds preserve near 3:4 distinction without stretching or upscaling',()=>{
 assert.deepEqual(resizeDimensions(6000,2000),[2048,683]);assert.deepEqual(resizeDimensions(3000,4000),[1536,2048]);
});
test('safe JPEG conversion is smaller WebP with original dimensions and immutable modified time',async()=>{
 browser();const original=jpeg();const [out]=await prepareFiles([original],signal());
 assert.notEqual(out.file,original);assert.equal(out.file.type,'image/webp');assert.equal(out.file.name,'photo.webp');assert.equal(out.file.lastModified,1234);
 assert.deepEqual(out.preprocessing,{version:2,original_width:6000,original_height:2000,captured_at_raw:null,captured_timezone:null});
 assert.equal(canvases[0].quality,.85);assert.equal(closed,1);assert.equal(canvases[0].width,0);
});
test('EXIF orientation/date are extracted before metadata-free decode',async()=>{
 browser();const [out]=await prepareFiles([jpeg(4000,3000,exif())],signal());
 assert.deepEqual(out.preprocessing,{version:2,original_width:3000,original_height:4000,captured_at_raw:'2020:01:02 03:04:05',captured_timezone:'+09:00'});
 assert.deepEqual(canvases[0].matrix,[0,1,-1,0,1536,0]);
});
test('unsafe color, >12MP, unknown format, malformed EXIF all bypass decode',async()=>{
 browser();const originals=[jpeg(4001,3000),jpeg(100,100,[255,226,0,4,1,2]),jpeg(100,100,[255,225,0,8,69,120,105,102,0,0]),new File(['abc'],'x.heic',{type:'image/heic'})];
 const out=await prepareFiles(originals,signal());out.forEach((v,i)=>assert.equal(v.file,originals[i]));assert.equal(decodes,0);
});
test('unsupported encoder, no saving and decoder failure preserve original and omit hints',async()=>{
 for(const mode of ['mime','size','decode','capability']) {browser();const original=jpeg();if(mode==='mime')encodeType='image/png';if(mode==='size')encodeSize=1000;if(mode==='decode')failDecode=true;if(mode==='capability')delete globalThis.createImageBitmap;
 const [out]=await prepareFiles([original],signal());assert.equal(out.file,original);assert.equal(out.preprocessing,undefined);}
});
test('batch preparation is sequential and abort closes decoded bitmap without starting next file',async()=>{
 browser();await prepareFiles([jpeg(),jpeg(),jpeg()],signal());assert.equal(maxActive,1);assert.equal(closed,3);
 browser();const abort=new AbortController();onDecode=()=>abort.abort();await assert.rejects(prepareFiles([jpeg(),jpeg()],abort.signal),{name:'AbortError'});assert.equal(decodes,1);assert.equal(closed,1);
});
function png(w=100,h=100,chunks=[]) {
 const chunk=(name,data)=>{const b=new Uint8Array(data.length+12);new DataView(b.buffer).setUint32(0,data.length);b.set(new TextEncoder().encode(name),4);b.set(data,8);return b;};
 const ihdr=new Uint8Array(13);const d=new DataView(ihdr.buffer);d.setUint32(0,w);d.setUint32(4,h);ihdr[8]=8;ihdr[9]=6;
 return new File([new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...chunks.map(([n,b])=>chunk(n,b)),chunk('IDAT',new Uint8Array(200)),chunk('IEND',[])],'alpha.png',{type:'image/png'});
}
test('transparent PNG uses transparent canvas and unsafe PNG color/HDR/animation fall back',async()=>{
 browser();globalThis.createImageBitmap=async()=>({width:100,height:100,close(){closed++;}});
 const [out]=await prepareFiles([png()],signal());assert.equal(out.file.type,'image/webp');assert.equal(out.preprocessing.original_width,100);
 for(const name of ['iCCP','cICP','acTL','tEXt']) {const file=png(100,100,[[name,new Uint8Array(4)]]);assert.equal((await prepareFiles([file],signal()))[0].file,file);}
});
test('all EXIF orientations preserve corrected original dimensions',async()=>{
 const expected=[[1,0,0,1,0,0],[-1,0,0,1,2048,0],[-1,0,0,-1,2048,1536],[1,0,0,-1,0,1536],[0,1,1,0,0,0],[0,1,-1,0,1536,0],[0,-1,-1,0,1536,2048],[0,-1,1,0,0,2048]];
 for(let orientation=1;orientation<=8;orientation++){browser();const [out]=await prepareFiles([jpeg(4000,3000,exif(orientation))],signal());assert.equal(out.preprocessing.original_width,orientation>=5?3000:4000);assert.deepEqual(canvases[0].matrix,expected[orientation-1]);}
});
test('abort during encoding releases canvas and bitmap; no result survives',async()=>{
 browser();const abort=new AbortController();const create=document.createElement;document.createElement=()=>{const c=create();const encode=c.toBlob;c.toBlob=(...args)=>{abort.abort();encode(...args);};return c;};
 await assert.rejects(prepareFiles([jpeg()],abort.signal),{name:'AbortError'});assert.equal(closed,1);assert.equal(canvases[0].height,0);
});

test('pair uses one bitmap, distinct 85/80 encodes and releases both canvases',async()=>{
 browser();const [out]=await prepareFiles([jpeg()],signal());assert.equal(decodes,1);
 assert.equal(out.thumbnail.type,'image/webp');assert.equal(canvases[1].quality,.8);
 assert.ok(canvases.every(c=>c.width===0 && c.height===0));
});
test('body retries at fixed quality from same bitmap and falls back at 1024',async()=>{
 browser();const original=new File([jpeg(),new Uint8Array(3_000_000)],'big.jpg',{type:'image/jpeg'});
 const sizes=[];const create=document.createElement;document.createElement=()=>{const c=create();const encode=c.toBlob;c.toBlob=(...args)=>{sizes.push([c.width,c.height,args[2]]);encodeSize=c.width>1100?1_000_001:100;encode(...args);};return c;};
 const [out]=await prepareFiles([original],signal());assert.equal(out.file.type,'image/webp');assert.equal(decodes,1);
 assert.deepEqual(sizes.map(x=>x[0]),[2048,1638,1310,1048,480]);assert.ok(sizes.slice(0,-1).every(x=>x[2]===.85));
 browser();encodeSize=1_000_001;const [fallback]=await prepareFiles([original],signal());assert.equal(fallback.file,original);assert.equal(decodes,1);
});
test('thumbnail cap omits optional file; pair total must save bytes',async()=>{
 browser();const original=jpeg();encodeSize=130;assert.equal((await prepareFiles([original],signal()))[0].file,original);
 browser();const large=new File([jpeg(),new Uint8Array(400000)],'big.jpg',{type:'image/jpeg'});encodeSize=200001;
 const [out]=await prepareFiles([large],signal());assert.equal(out.file.type,'image/webp');assert.equal(out.thumbnail,undefined);
});
test('near-square metadata preserves input distinction and 16MP remains server-only',async()=>{
 browser();for(const [w,h] of [[3001,3000],[3000,3001],[3000,3000]]) {const [out]=await prepareFiles([jpeg(w,h)],signal());assert.equal(out.preprocessing.original_width,w);assert.equal(out.preprocessing.original_height,h);}
 for(const [w,h] of [[4001,4000],[4000,4001],[4000,4000]]) {const f=jpeg(w,h);assert.equal((await prepareFiles([f],signal()))[0].file,f);}
 assert.equal(decodes,3);
});

test('small originals are never enlarged in either output',async()=>{
 browser();const sizes=[];const create=document.createElement;document.createElement=()=>{const c=create();const encode=c.toBlob;c.toBlob=(...args)=>{sizes.push([c.width,c.height]);encode(...args);};return c;};
 await prepareFiles([jpeg(100,50)],signal());assert.deepEqual(sizes,[[100,50],[100,50]]);
});
test('abort during thumbnail encode releases every surface and does not prepare next image',async()=>{
 browser();const abort=new AbortController();let count=0;const create=document.createElement;document.createElement=()=>{const c=create();const encode=c.toBlob;c.toBlob=(...args)=>{if(++count===2)abort.abort();encode(...args);};return c;};
 await assert.rejects(prepareFiles([jpeg(),jpeg()],abort.signal),{name:'AbortError'});
 assert.equal(decodes,1);assert.equal(closed,1);assert.ok(canvases.every(c=>c.width===0 && c.height===0));
});

test('exact portrait retries preserve 3k x 4k pixels and original hints through the 1024 floor',async()=>{
 for(const orientation of [1,6]) {
  browser();const sizes=[];const create=document.createElement;
  document.createElement=()=>{const c=create();const encode=c.toBlob;c.toBlob=(...args)=>{sizes.push([c.width,c.height]);encodeSize=c.height>1024?1_000_001:100;encode(...args);};return c;};
  const source=orientation===1?jpeg(3000,4000):jpeg(4000,3000,exif(orientation));
  const original=new File([source,new Uint8Array(3_000_000)],'portrait.jpg',{type:'image/jpeg'});
  const [out]=await prepareFiles([original],signal());
  assert.equal(out.file.type,'image/webp');assert.equal(out.preprocessing.original_width,3000);assert.equal(out.preprocessing.original_height,4000);
  assert.equal(decodes,1);assert.deepEqual(sizes,[[1536,2048],[1227,1636],[981,1308],[786,1048],[768,1024],[360,480]]);
  for(const [w,h] of sizes) {
   assert.equal(w*4,h*3);assert.ok(w<=3000 && h<=4000);
   // The common-scale interval required by server preprocessing_hints must exist.
   assert.ok(Math.max((w-.5)/3000,(h-.5)/4000)<Math.min((w+.5)/3000,(h+.5)/4000,1));
  }
 }
 assert.deepEqual(resizeDimensions(3,4),[3,4]);
});
