import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'upload-messages-'));
await build({entryPoints:['src/features/uploads/uploadMessages.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'messages.mjs')});
const {uploadMessages,photoReady,photoFailed}=await import(join(dir,'messages.mjs'));
const page=(id,status='ready')=>({id,position:1,upload_status:status});
const item=(id,options={})=>({id,file:new File(['x'],id+'.jpg'),state:'selected',...options});
const batch=(...photos)=>({id:'batch',photos:photos.map(([itemId,pageId])=>({itemId,pageId}))});

test('a local acknowledgement and its server page occupy one photo in one message',()=>{
 const file=item('i',{submitted:true,batchId:'batch',pageId:'p',state:'checking'});
 const result=uploadMessages([page('p')],[file],[batch(['i','p'])]);
 assert.equal(result.messages.length,1);assert.equal(result.messages[0].photos.length,1);assert.equal(photoReady(result.messages[0].photos[0]),true);
});
test('a saved photo remains visible before the server gallery refresh arrives',()=>{
 const file=item('i',{submitted:true,batchId:'batch',pageId:'p',state:'saved'});
 const result=uploadMessages([],[file],[batch(['i','p'])]);assert.equal(result.messages[0].photos.length,1);assert.equal(photoReady(result.messages[0].photos[0]),true);
});
test('releasing source files preserves the message and original selection order around a failure',()=>{
 const refs=batch(['first','p1'],['second',undefined],['third','p3']);
 const failed=item('second',{submitted:true,batchId:'batch',state:'failed'});
 const result=uploadMessages([page('p1'),page('p3')],[failed],[refs]);
 assert.deepEqual(result.messages[0].photos.map(photo=>photo.item?.id??photo.page.id),['p1','second','p3']);
 assert.equal(result.messages[0].photos.filter(photoFailed).length,1);
});
test('unsubmitted selections and invalid attachments remain outside sent messages',()=>{
 const result=uploadMessages([],[item('a'),item('b',{state:'failed'})],[]);
 assert.equal(result.messages.length,0);assert.equal(result.attached.length,2);
});
test('reopening from server data groups stored photos without fabricating send history',()=>{
 const result=uploadMessages([page('a'),page('b')],[],[]);assert.equal(result.messages.length,1);assert.equal(result.messages[0].id,'stored-photos');assert.equal(result.messages[0].photos.length,2);
});
test('deleted page references disappear and repeated references cannot duplicate photos',()=>{
 const result=uploadMessages([page('p')],[],[batch(['old','deleted'],['i','p']),{id:'duplicate',photos:[{itemId:'j',pageId:'p'}]}]);
 assert.equal(result.messages.length,1);assert.equal(result.messages[0].photos.length,1);
 assert.equal(photoFailed({id:'p',page:page('p'),item:item('i',{state:'failed'})}),false);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
