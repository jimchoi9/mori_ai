import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/nfc/bookPhotos.ts','src/features/nfc/photoLayout.ts'],bundle:true,platform:'node',format:'esm',outdir:'nfc-photo-check'});
const {photoLayout}=await import('../nfc-photo-check/photoLayout.js');
const {createBookPhotos}=await import('../nfc-photo-check/bookPhotos.js');
const box=(width=390,height=600)=>{const values=new Map(),classes=new Set();return {clientWidth:width,clientHeight:height,classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k),getPropertyValue:k=>values.get(k)||''}};};
const image=(width=0,height=0,parent=box())=>{const attrs=new Map(),media=new EventTarget();Object.assign(media,{naturalWidth:width,naturalHeight:height,parentElement:parent,getAttribute:k=>attrs.get(k)||null,removeAttribute:k=>attrs.delete(k)});Object.defineProperty(media,'src',{set:v=>attrs.set('src',v)});return {src:'blob:photo',media};};
const displayed=(ratio,w=390,h=600)=>{const plan=photoLayout(ratio*1000,1000,w,h),contain=Math.min(w/(ratio*1000),h/1000);return {...plan,height:1000*contain*plan.zoom,width:ratio*1000*contain*plan.zoom};};
test('portrait and square fill the photo slot across tall and short viewports',()=>{
 for(const ratio of [.5,.75,1])for(const [w,h] of [[390,600],[430,500],[300,700]]){const p=displayed(ratio,w,h);assert.equal(p.portrait,true);assert.ok(p.width>=w-1e-8&&p.height>=h-1e-8);}
 assert.equal(photoLayout(0,100,390,600),null);
});
test('square and4:3 boundaries remain continuous; just-wide photos do not suddenly shrink',()=>{
 for(const ratio of [1,4/3]){const a=displayed(ratio-1e-7),b=displayed(ratio+1e-7);assert.ok(Math.abs(a.height-b.height)<.001);}
 assert.ok(displayed(1.01).height>599);
 for(const ratio of [4/3,1.5,16/9,2,3]){const p=displayed(ratio);assert.ok((1-390/p.width)/2<=.05+1e-9);}
 for(let i=1;i<=600;i++){const ratio=.5+i/240,p=displayed(ratio),contain=Math.min(390/(ratio*1000),.6),cover=Math.max(390/(ratio*1000),.6);assert.ok(p.zoom>=1-1e-9&&p.zoom<=cover/contain+1e-9);}
});
test('late decode and rebuilt hidden slots get their layout without reviving distant or destroyed photos',()=>{
 const a=image(900,1600),b=image(0,0,box(0,0)),c=image(1600,900),photos=createBookPhotos([a,b,c]);
 photos.nearby(0);assert.equal(a.media.parentElement.classList.contains('story-portrait'),true);assert.equal(b.media.parentElement.style.getPropertyValue('--story-scale'),'');
 b.media.naturalWidth=1600;b.media.naturalHeight=900;b.media.dispatchEvent(new Event('load'));assert.ok(Number(b.media.parentElement.style.getPropertyValue('--story-scale'))>1);
 a.media.parentElement=box(300,650);b.media.parentElement=box(0,0);photos.nearby(0);assert.ok(Number(b.media.parentElement.style.getPropertyValue('--story-scale'))>1);
 photos.nearby(2);assert.equal(a.media.getAttribute('src'),null);a.media.dispatchEvent(new Event('load'));assert.equal(a.media.parentElement.style.getPropertyValue('--story-scale'),'');
 photos.destroy();for(const p of [a,b,c]){p.media.dispatchEvent(new Event('load'));assert.equal(p.media.parentElement.style.getPropertyValue('--story-scale'),'');assert.equal(p.media.parentElement.style.getPropertyValue('--story-backdrop'),'');}
});
test.after(async()=>{await unlink('nfc-photo-check/photoLayout.js');await unlink('nfc-photo-check/bookPhotos.js');const {rmdir}=await import('node:fs/promises');await rmdir('nfc-photo-check');});
