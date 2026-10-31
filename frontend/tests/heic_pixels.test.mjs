import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import factory from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
const dir=await mkdtemp(join(tmpdir(),'heic-pixels-'));
await build({entryPoints:['src/features/uploads/heicPixels.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'pixels.mjs')});
await build({entryPoints:['src/features/uploads/heicColor.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'color.mjs')});
const {decodeHeicPixels}=await import(join(dir,'pixels.mjs')),{heicIccColorSpace}=await import(join(dir,'color.mjs'));
const lib=await factory({print:()=>{},printErr:()=>{}});
const fixture=new Uint8Array(await readFile(new URL('../../tests/fixtures/media/primary-second.heic',import.meta.url)));
test('real WASM decoding selects the declared primary image instead of the first image',async()=>{
 const result=await decodeHeicPixels(lib,fixture);
 assert.equal(result.width,30);assert.equal(result.height,40);assert.equal(result.colorSpace,'srgb');
 assert.equal(result.data.length,30*40*4);assert.ok(result.data[0]<5&&result.data[1]<5&&result.data[2]>245);
});
test('malformed HEIC has no fallback pixels',async()=>{
 await assert.rejects(decodeHeicPixels(lib,new Uint8Array([0,1,2,3])),{code:'decode'});
});
test('pixel limits and HDR bit depth are rejected before a full pixel surface is decoded, releasing handles',async()=>{
 for(const [width,bits,expected] of [[40_000_001,8,'size'],[4000,10,'color']]){
  let displayed=0,freed=0,released=0;
  const image={handle:{$$:{ptr:1}},get_width:()=>width,get_height:()=>1,is_primary:()=>true,display:()=>displayed++,free:()=>freed++};
  const fake={HeifDecoder:class{decoder={};decode(){return [image];}},heif_context_free:()=>released++,_heif_image_handle_get_luma_bits_per_pixel:()=>bits,_heif_image_handle_get_chroma_bits_per_pixel:()=>bits};
  await assert.rejects(decodeHeicPixels(fake,new Uint8Array(24)),{code:expected});
  assert.equal(displayed,0);assert.equal(freed,1);assert.equal(released,1);
 }
});
function profile(space='display-p3',lut=false){
 const matrix=space==='srgb'?[.436075,.222505,.013932,.385065,.716879,.097105,.143080,.060617,.714173]:[.515102,.241182,-.001049,.291965,.692236,.041881,.157153,.066581,.784378];
 const tags=['rXYZ','gXYZ','bXYZ','wtpt','rTRC','gTRC','bTRC',...(lut?['A2B0']:[])],start=132+12*tags.length,bytes=new Uint8Array(start+4*20+(tags.length-4)*32),d=new DataView(bytes.buffer);
 const text=(p,s)=>bytes.set(new TextEncoder().encode(s),p),fixed=(p,v)=>d.setInt32(p,Math.round(v*65536));
 d.setUint32(0,bytes.length);text(16,'RGB ');text(20,'XYZ ');text(36,'acsp');d.setUint32(128,tags.length);let offset=start;
 for(let i=0;i<tags.length;i++){
  const length=i<4?20:32;const p=132+i*12;text(p,tags[i]);d.setUint32(p+4,offset);d.setUint32(p+8,length);
  if(i<4){text(offset,'XYZ ');const values=i===3?[.9642,1,.8249]:matrix.slice(i*3,i*3+3);values.forEach((v,j)=>fixed(offset+8+j*4,v));}
  else{text(offset,'para');d.setUint16(offset+8,3);[2.4,1/1.055,.055/1.055,1/12.92,.04045].forEach((v,j)=>fixed(offset+12+j*4,v));}
  offset+=length;
 }
 return bytes;
}
test('standard Display P3 and sRGB retain their color-space labels; unknown or linear profiles are refused',()=>{
 assert.equal(heicIccColorSpace(profile()),'display-p3');assert.equal(heicIccColorSpace(profile('srgb')),'srgb');
 const invalid=profile();new DataView(invalid.buffer).setInt32(invalid.length-20,65536);
 assert.throws(()=>heicIccColorSpace(invalid));assert.throws(()=>heicIccColorSpace(new Uint8Array(20)));
 const linear=profile(),offset=linear.length-32,view=new DataView(linear.buffer);linear.set(new TextEncoder().encode('curv'),offset);view.setUint32(offset+8,2);view.setUint16(offset+12,0);view.setUint16(offset+14,65535);
 assert.throws(()=>heicIccColorSpace(linear));assert.throws(()=>heicIccColorSpace(profile('display-p3',true)));
});
test.after(()=>rm(dir,{recursive:true,force:true}));
