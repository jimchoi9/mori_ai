import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectJpegGps} from './gpsEvidence.mjs';
function jpeg({zeroed=false,le=true}={}) {
 const tiff=new Uint8Array(8+18+54+48),v=new DataView(tiff.buffer);
 const u16=(p,n)=>v.setUint16(p,n,le),u32=(p,n)=>v.setUint32(p,n,le);
 tiff.set(le?[73,73]:[77,77]);u16(2,42);u32(4,8);u16(8,1);
 u16(10,34853);u16(12,4);u32(14,1);u32(18,26);u16(26,4);
 for(let i=0;i<4;i++) {
  const p=28+12*i;u16(p,i+1);u16(p+2,i%2?5:2);u32(p+4,i%2?3:2);
  if(i%2){const start=80+(i===3?24:0);u32(p+8,start);if(!zeroed)for(let n=0;n<3;n++)u32(start+8*n+4,1);}
  else if(!zeroed)tiff[p+8]=i===0?78:69;
 }
 const bytes=new Uint8Array(tiff.length+14);bytes.set([255,216,255,225]);
 new DataView(bytes.buffer).setUint16(4,tiff.length+8);bytes.set([69,120,105,102,0,0],6);bytes.set(tiff,12);bytes.set([255,217],bytes.length-2);return bytes;
}
test('zeroed EXIF references and rational payloads are detected in both byte orders',()=>{
 for(const le of [true,false])assert.equal(inspectJpegGps(jpeg({zeroed:true,le})),'zeroed');
});
test('valid 0° coordinates with nonzero denominators are not mistaken for redaction',()=>{
 for(const le of [true,false])assert.equal(inspectJpegGps(jpeg({le})),'present');
});
test('missing EXIF, truncated data and non-JPEG remain distinct',()=>{
 assert.equal(inspectJpegGps(Uint8Array.of(255,216,255,217)),'absent');
 assert.equal(inspectJpegGps(jpeg().subarray(0,40)),'unreadable');
 assert.equal(inspectJpegGps(Uint8Array.of(1,2,3)),'unsupported');
});
