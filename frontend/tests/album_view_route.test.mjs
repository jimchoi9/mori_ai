import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
const dir=await mkdtemp(join(process.cwd(),'.album-view-route-'));
await build({entryPoints:['src/App.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile:join(dir,'app.mjs'),plugins:[{name:'route-boundary',setup(b){
 b.onResolve({filter:/^react(?:\/.*)?$|^react-router$/},a=>({path:a.path,external:true}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
 b.onResolve({filter:/features\//},a=>({path:a.path,namespace:'screen'}));
 b.onLoad({filter:/.*/,namespace:'screen'},a=>({contents:a.path.endsWith('AuthGate')?`export const AuthGate=({children})=>children({user:{id:'owner'}},()=>{},()=>{},null);`:a.path.endsWith('AlbumMemoryViewer')?`import React from 'react';import {useParams} from 'react-router';export const AlbumMemoryViewer=()=>React.createElement('div',{'data-album':useParams().albumId},'책');`:`export const AdminGate=()=>null,NfcExperience=()=>null,GiftRegistration=()=>null,GiftTokenCapture=()=>null,PurchaseDetail=()=>null,PurchasePhotos=()=>null,PurchaseReturn=()=>null,workspaceKey=()=>'',GoodsWorkspace=()=>null,Designs=()=>null,DesignDetail=()=>null,Bookshelf=()=>null,AlbumEditor=()=>null,GenerationProgress=()=>null,ReviewEditor=()=>null,AlbumViewer=()=>null;`}));
}}]});
const {default:App}=await import(join(dir,'app.mjs'));
test('direct owner book and refresh resolve the album ID inside a route context',()=>{
 for(const id of ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']){
  const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[`/albums/${id}/view`]},React.createElement(App)));
  assert.match(html,new RegExp(`data-album="${id}"`));
 }
});
test.after(()=>rm(dir,{recursive:true,force:true}));
