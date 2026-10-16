import test from 'node:test';
import assert from 'node:assert/strict';
const albums=await import(process.argv[2]).catch(()=>({}));
globalThis.window=new EventTarget();
const detail={detail:{album:{id:'album-a',title:'나의 사진첩',status:'published',version:17,page_count:0,cover:null,created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T01:00:00Z',published_at:'2026-10-16T01:00:00Z'},pages:[],order_mode:'date',active_run_id:null},media_access:[]};
test('bookshelf deletion reads the latest album version instead of using the displayed stale version',async()=>{
 assert.equal(typeof albums.removeAlbum,'function');
 const oldFetch=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push([url,options.method]);return new Response(JSON.stringify({data:options.method==='GET'?detail:{album_id:'album-a',status:'deleted'}}),{status:options.method==='GET'?200:202});};
 try{await albums.removeAlbum('album-a',new AbortController().signal);
  assert.deepEqual(calls,[['/api/v1/albums/album-a','GET'],['/api/v1/albums/album-a?expected_version=17','DELETE']]);
 }finally{globalThis.fetch=oldFetch;}
});
test('a refused delete remains a failure instead of displaying fake success',async()=>{
 assert.equal(typeof albums.removeAlbum,'function');
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>options.method==='GET'?new Response(JSON.stringify({data:detail}),{status:200}):new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',details:{current_version:18}}}),{status:409});
 try{await assert.rejects(albums.removeAlbum('album-a',new AbortController().signal),error=>error.status===409&&error.details.current_version===18);}finally{globalThis.fetch=oldFetch;}
});
