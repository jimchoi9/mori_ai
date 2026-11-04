import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'capture-date-'));
await build({entryPoints:['src/features/uploads/captureMetadata.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'metadata.mjs')});
const {readCaptureMetadata:captureHints}=await import(join(dir,'metadata.mjs'));
const text=s=>new TextEncoder().encode(s),joinBytes=(...a)=>new Uint8Array(Buffer.concat(a.map(x=>Buffer.from(x))));
const u16=n=>new Uint8Array([n>>>8,n&255]);
const u32=n=>new Uint8Array([n>>>24,(n>>>16)&255,(n>>>8)&255,n&255]);
const box=(kind,...a)=>{const data=joinBytes(...a);return joinBytes(u32(data.length+8),text(kind),data);};
const full=(kind,version,...a)=>box(kind,new Uint8Array([version,0,0,0]),...a);
export function tiff(date='2026:10:01 12:30:00',zone='+09:00',little=true){
 const bytes=new Uint8Array(100),d=new DataView(bytes.buffer);
 bytes.set(text(little?'II':'MM'));d.setUint16(2,42,little);d.setUint32(4,8,little);d.setUint16(8,1,little);
 d.setUint16(10,34665,little);d.setUint16(12,4,little);d.setUint32(14,1,little);d.setUint32(18,26,little);
 d.setUint16(26,2,little);
 for(const [p,tag,count,start] of [[28,36867,20,56],[40,36881,7,76]]){d.setUint16(p,tag,little);d.setUint16(p+2,2,little);d.setUint32(p+4,count,little);d.setUint32(p+8,start,little);}
 bytes.set(text(date+'\0'),56);bytes.set(text(zone+'\0'),76);return bytes;
}
function heic({date='2026:10:01 12:30:00',method=0,version=0,primary=2,linked=2,multiple=false,large=false,fragmented=false,offset=0,little=true,metadata}={}){
 const exif=joinBytes(u32(offset),new Uint8Array(offset),metadata??tiff(date,'+09:00',little));
 const other=joinBytes(u32(0),tiff('2001:01:01 00:00:00'));
 const id=n=>version===2?u32(n):u16(n);
 const infe=n=>full('infe',2,u16(n),u16(0),text('Exif'),text('date\0'));
 const iinf=full('iinf',0,u16(multiple?2:1),infe(5),...(multiple?[infe(6)]:[]));
 const references=full('iref',0,box('cdsc',u16(5),u16(1),u16(linked)),...(multiple?[box('cdsc',u16(6),u16(1),u16(1))]:[]));
 const ftyp=box('ftyp',text('heic'),u32(0),text('heicmif1'));
 function meta(start){
  const entry=(n,at,length)=>joinBytes(id(n),...(version?[u16(method)]:[]),u16(0),u16(n===5&&fragmented?2:1),u32(at),u32(n===5&&fragmented?8:length),...(n===5&&fragmented?[u32(at+8),u32(length-8)]:[]));
  const iloc=full('iloc',version,new Uint8Array([0x44,0]),id(multiple?2:1),entry(5,start,exif.length),...(multiple?[entry(6,start+exif.length,other.length)]:[]));
  return full('meta',0,full('pitm',0,u16(primary)),iinf,iloc,references,...(method===1?[box('idat',exif,...(multiple?[other]:[]))]:[]));
 }
 const header=meta(0),mdatHeader=large?16:8;
 const m=meta(method===1?0:ftyp.length+header.length+mdatHeader);
 const data=joinBytes(exif,...(multiple?[other]:[]));
 const mdat=large?joinBytes(u32(1),text('mdat'),u32(0),u32(data.length+16),data):box('mdat',data);
 return joinBytes(ftyp,m,...(method===1?[]:[mdat]));
}
const expected={date:'2026:10:01 12:30:00',timezone:'+09:00'},empty={date:null,timezone:null};
test('HEIC primary metadata is read before optimization without decoding pixels',()=>{
 assert.deepEqual(captureHints(heic({multiple:true}),'image/heic'),expected);
 assert.deepEqual(captureHints(heic({primary:1,linked:2,multiple:true}),'image/heic'),{date:'2001:01:01 00:00:00',timezone:'+09:00'});
 assert.deepEqual(captureHints(heic({linked:1}),'image/heic'),empty);
});
test('HEIF supports iloc versions 0/1/2, file/idat extents, offset TIFF, big endian and large boxes',()=>{
 for(const options of [{},{version:1},{version:2},{version:1,method:1},{version:2,method:1},{offset:6},{little:false},{large:true},{fragmented:true}]){
  assert.deepEqual(captureHints(heic(options),'image/heif'),expected,JSON.stringify(options));
 }
});
test('JPEG/PNG/WebP extract the same calendar date without depending on decoder/color support',()=>{
 const exif=joinBytes(text('Exif\0\0'),tiff());
 const jpeg=joinBytes(new Uint8Array([255,216,255,225]),u16(exif.length+2),exif,new Uint8Array([255,217]));
 assert.deepEqual(captureHints(jpeg,'image/jpeg'),expected);
 const png=joinBytes(new Uint8Array([137,80,78,71,13,10,26,10]),box('eXIf',tiff()));
 // PNG chunks use length before type, with a CRC after the payload.
 new DataView(png.buffer).setUint32(8,tiff().length);
 assert.deepEqual(captureHints(joinBytes(png,new Uint8Array(4)),'image/png'),expected);
 const data=tiff(),chunk=joinBytes(text('EXIF'),new Uint8Array([data.length,0,0,0]),data);
 const webp=joinBytes(text('RIFF'),new Uint8Array([chunk.length+4,0,0,0]),text('WEBP'),chunk);
 assert.deepEqual(captureHints(webp,'image/webp'),expected);
});
test('missing, invalid calendar date and truncated HEIC metadata fall back without rejecting the photo',()=>{
 assert.deepEqual(captureHints(heic({date:'2026:02:30 12:30:00'}),'image/heic'),empty);
 const bytes=heic();for(let length=0;length<bytes.length;length++)assert.deepEqual(captureHints(bytes.subarray(0,length),'image/heic'),empty);
 assert.deepEqual(captureHints(new Uint8Array([1,2,3]),'image/jpeg'),empty);
 assert.deepEqual(captureHints(heic({method:2,version:1}),'image/heic'),empty);
});
test('unrelated embedded EXIF signatures do not become the primary capture date',()=>{
 const misleading=box('ftyp',text('heic'),u32(0),text('heicmif1'));
 assert.deepEqual(captureHints(joinBytes(misleading,box('free',text('Exif\0\0'),tiff())),'image/heic'),empty);
});
test('real libheif-encoded two-photo HEIC reads the second primary date',async()=>{
 const data=new Uint8Array(await readFile('../tests/fixtures/media/capture-primary-second.heic'));
 assert.deepEqual(captureHints(data,'image/heic'),expected);
});
test.after(()=>rm(dir,{recursive:true,force:true}));

function gpsTiff({little=true,date='2026:10:01 12:30:00',south=false,west=false}={}){
 const bytes=new Uint8Array(250);bytes.set(tiff(date,'+09:00',little));const d=new DataView(bytes.buffer);
 d.setUint32(4,100,little);d.setUint16(100,2,little);
 for(const [p,tag,at] of [[102,34665,26],[114,34853,132]]){d.setUint16(p,tag,little);d.setUint16(p+2,4,little);d.setUint32(p+4,1,little);d.setUint32(p+8,at,little);}
 d.setUint16(132,4,little);
 for(const [p,tag,type,count,at] of [[134,1,2,2,0],[146,2,5,3,190],[158,3,2,2,0],[170,4,5,3,214]]){
  d.setUint16(p,tag,little);d.setUint16(p+2,type,little);d.setUint32(p+4,count,little);d.setUint32(p+8,at,little);
 }
 bytes.set(text((south?'S':'N')+'\0'),142);bytes.set(text((west?'W':'E')+'\0'),166);
 for(const [at,values] of [[190,[35,14,24]],[214,[129,13,12]]])for(let i=0;i<3;i++){d.setUint32(at+i*8,values[i],little);d.setUint32(at+i*8+4,1,little);}
 return bytes;
}
const jpegExif=data=>{const e=joinBytes(text('Exif\0\0'),data);return joinBytes(new Uint8Array([255,216,255,225]),u16(e.length+2),e,new Uint8Array([255,217]));};
test('GPS survives missing or invalid date and supports both byte orders and hemispheres',()=>{
 for(const little of [true,false])for(const date of ['2026:02:30 00:00:00','0000:00:00 00:00:00']){
  assert.deepEqual(captureHints(jpegExif(gpsTiff({little,date,south:true,west:true})),'image/jpeg'),{date:null,timezone:null,gps:{latitude:-35.24,longitude:-129.22}});
 }
 const raw=gpsTiff();new DataView(raw.buffer).setUint32(110,99999,true);
 assert.deepEqual(captureHints(jpegExif(raw),'image/jpeg'),{date:null,timezone:null,gps:{latitude:35.24,longitude:129.22}});
});
test('GPS uses primary HEIC item and supports PNG/WebP metadata',()=>{
 const raw=gpsTiff(),want={...expected,gps:{latitude:35.24,longitude:129.22}};
 assert.deepEqual(captureHints(heic({metadata:raw,multiple:true}),'image/heic'),want);
 assert.deepEqual(captureHints(heic({metadata:raw,multiple:true,primary:1,linked:2}),'image/heic'),{date:'2001:01:01 00:00:00',timezone:'+09:00'});
 const png=joinBytes(new Uint8Array([137,80,78,71,13,10,26,10]),u32(raw.length),text('eXIf'),raw,new Uint8Array(4));
 assert.deepEqual(captureHints(png,'image/png'),want);
 const chunk=joinBytes(text('EXIF'),new Uint8Array([raw.length,0,0,0]),raw),n=chunk.length+4;
 assert.deepEqual(captureHints(joinBytes(text('RIFF'),new Uint8Array([n&255,n>>>8,0,0]),text('WEBP'),chunk),'image/webp'),want);
});
test('bad GPS is discarded without losing valid capture time',()=>{
 for(const mutate of [d=>d.setUint32(194,0,true),d=>d.setUint32(190,91,true),d=>d.setUint32(202,0,true),d=>d.setUint32(214,181,true),d=>d.setUint32(154,99999,true),d=>d.setUint8(142,88),d=>{d.setUint8(142,0);d.setUint32(194,0,true)}]){
  const raw=gpsTiff();mutate(new DataView(raw.buffer));assert.deepEqual(captureHints(jpegExif(raw),'image/jpeg'),expected);
 }
});
