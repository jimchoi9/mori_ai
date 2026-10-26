import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/goods/PurchaseDetail.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'goods-purchase-check.mjs',plugins:[{name:'harness',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'style'}));b.onLoad({filter:/.*/,namespace:'style'},()=>({contents:''}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react-router'?`export const Link='link',Navigate='navigate',useParams=()=>({purchaseId:'purchase'}),useLocation=()=>({pathname:'/albums/00000000-0000-0000-0000-000000000001/edit'});`:a.path==='react'?`export const forwardRef=f=>f;`:`export const useQuery=()=>query;`}));
}}]});
const {PurchaseDetail,PurchasePhotos,PurchaseReturn}=await import('../goods-purchase-check.mjs');
function nodes(t){if(!t||typeof t!=='object')return [];if(Array.isArray(t))return t.flatMap(nodes);return [t,...nodes(t.props?.children)];}
const purchase={id:'purchase',design_id:'design',album_id:'album',album_status:'draft',can_manage:true,gift:false,product:'magnet',created_at:'2026-10-26T00:00:00Z',image_url:'/image',address_ready:false,upload_url:null,files:{},delivery_status:'waiting_configuration'};
test('purchase has one primary photo action even while mail and address are unconfigured',()=>{
 globalThis.query={data:purchase};const tree=PurchaseDetail({userId:'user'}),links=nodes(tree).filter(n=>n.type==='link');
 assert.equal(links.filter(n=>n.props.className?.includes('purchase-primary')).length,1);
 assert.equal(links.find(n=>n.props.className?.includes('purchase-primary')).props.to,'/purchases/purchase/photos');
 assert.equal(nodes(tree).some(n=>n.type==='img'&&n.props.className==='purchase-qr'),false);
});
test('photo QR resumes the actual draft album and completed albums return to purchase resources',()=>{
 globalThis.query={data:purchase};assert.equal(PurchasePhotos({userId:'user'}).props.to,'/albums/album/edit');
 query.data={...purchase,album_status:'published'};assert.equal(PurchasePhotos({userId:'user'}).props.to,'/purchases/purchase');
 assert.ok(!nodes(PurchaseDetail({userId:'user'})).some(n=>n.props?.to?.endsWith('/view')));
});
test('deleted albums keep original materials without photo add or new checkout',()=>{
 globalThis.query={data:{...purchase,album_status:'deleted'}};const tree=PurchaseDetail({userId:'user'});
 assert.match(JSON.stringify(tree),/삭제되었습니다/);
 assert.ok(!nodes(tree).some(n=>n.props?.to==='/purchases/purchase/photos'));
 assert.ok(nodes(tree).some(n=>n.props?.href?.endsWith('/files/original')));
});
test('album return is resolved from the server, independent of session storage',()=>{
 globalThis.query={data:{purchase_id:'purchase'}};
 assert.equal(nodes(PurchaseReturn({userId:'user'})).find(n=>n.type==='link').props.to,'/purchases/purchase');
});
test.after(()=>unlink('goods-purchase-check.mjs'));
