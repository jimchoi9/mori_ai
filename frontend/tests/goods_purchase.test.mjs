import test from 'node:test';
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import {build} from 'esbuild';
await build({entryPoints:['src/features/goods/PurchaseDetail.tsx'],bundle:true,platform:'node',format:'esm',jsx:'automatic',outfile:'goods-purchase-check.mjs',plugins:[{name:'harness',setup(b){
 b.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'style'}));b.onLoad({filter:/.*/,namespace:'style'},()=>({contents:''}));
 b.onResolve({filter:/^(react|react\/jsx-runtime|react-router|@tanstack\/react-query)$/},a=>({path:a.path,namespace:'harness'}));
 b.onLoad({filter:/.*/,namespace:'harness'},a=>({contents:a.path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment='fragment';`:a.path==='react-router'?`export const Link='link',Navigate='navigate',useParams=()=>({purchaseId:'purchase'}),useLocation=()=>({pathname:'/albums/00000000-0000-0000-0000-000000000001/edit',search:globalThis.search??''});`:a.path==='react'?`export const forwardRef=f=>f;`:`export const useQuery=o=>{globalThis.queries?.push(o);return o.queryKey[0]==='client-config'?globalThis.configQuery??{}:o.queryKey[0]==='purchase-album'?globalThis.albumQuery??{}:query;};`}));
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
test('deleted albums keep the purchased design without photo actions or production downloads',()=>{
 globalThis.query={data:{...purchase,album_status:'deleted'}};const tree=PurchaseDetail({userId:'user'});
 assert.match(JSON.stringify(tree),/삭제되었습니다/);
 assert.ok(!nodes(tree).some(n=>n.props?.to==='/purchases/purchase/photos'));
 assert.ok(nodes(tree).some(n=>n.type==='img'&&n.props.src==='/image'));
 assert.ok(!nodes(tree).some(n=>n.type==='a'&&n.props.download!==undefined));
});
test('album return is resolved from the server, independent of session storage',()=>{
 globalThis.query={data:{purchase_id:'purchase'}};
 assert.equal(nodes(PurchaseReturn({userId:'user'})).find(n=>n.type==='link').props.to,'/purchases/purchase?details=1');
});
function content(pages,{details=false,owner=true,gift=false}={}){
 globalThis.search=details?'?details=1':'';
 globalThis.query={data:{...purchase,can_manage:owner,gift}};
 globalThis.configQuery={data:{album_content_enabled:true}};
 globalThis.albumQuery={data:{detail:{pages}}};
 globalThis.queries=[];
}
test('empty purchased album shows purchase completion and one photo action, with production tools absent',()=>{
 content([]);const tree=PurchaseDetail({userId:'user'}),all=nodes(tree);
 assert.ok(all.some(n=>n.props?.title==='구매가 완료됐어요'));
 assert.equal(all.filter(n=>n.props?.className?.includes('purchase-primary')).length,1);
 assert.ok(all.some(n=>n.props?.children==='사진 채우기'));
 assert.ok(!/A4 제작|원화 PNG|배치 안내 PNG|확정 정보|제작 자료 전달/.test(JSON.stringify(tree)));
});
test('stored photos bypass the purchase page even while album status is draft',()=>{
 content([{id:'photo'}]);const tree=PurchaseDetail({userId:'user'});
 assert.equal(tree.type,'navigate');assert.equal(tree.props.to,'/albums/album/manage');assert.equal(tree.props.replace,true);
});
test('explicit order details remain reachable after photos are added',()=>{
 content([{id:'photo'}],{details:true});const tree=PurchaseDetail({userId:'user'}),all=nodes(tree);
 assert.notEqual(tree.type,'navigate');assert.ok(all.some(n=>n.props?.title==='주문 내역'));
 assert.equal(all.find(n=>n.props?.className?.includes('purchase-primary')).props.to,'/albums/album/manage');
 assert.ok(!/A4 제작|원화 PNG|제작 자료 전달/.test(JSON.stringify(tree)));
});
test('pending lookup waits; lookup failure still permits entering photos',()=>{
 content([]);albumQuery={isPending:true};assert.equal(PurchaseDetail({userId:'user'}).props.role,'status');
 albumQuery={isError:true};const all=nodes(PurchaseDetail({userId:'user'}));
 assert.ok(all.some(n=>n.props?.role==='alert'));
 assert.ok(all.some(n=>n.props?.to==='/purchases/purchase/photos'));
});
test('gift purchaser cannot look up or enter a recipient album and retains registration QR',()=>{
 content([{id:'photo'}],{owner:false,gift:true});query.data={...query.data,upload_url:'/gift',files:{qr:'/qr'}};
 const tree=PurchaseDetail({userId:'user'}),all=nodes(tree);
 assert.equal(queries.find(q=>q.queryKey[0]==='purchase-album').enabled,false);
 assert.notEqual(tree.type,'navigate');assert.ok(all.some(n=>n.type==='summary'&&n.props.children==='선물 등록 QR'));
 assert.ok(!all.some(n=>n.props?.to==='/albums/album/manage'));
 query.data.gift_registered=true;assert.match(JSON.stringify(PurchaseDetail({userId:'user'})),/선물받은 분의 앨범/);
});
test('processing albums keep their progress destination and gift return path is preserved',()=>{
 content([{id:'photo'}]);query.data.album_status='processing';
 assert.equal(nodes(PurchaseDetail({userId:'user'})).find(n=>n.props?.className?.includes('purchase-primary')).props.to,'/albums/album/progress');
 query.data={purchase_id:'purchase',return_path:'/gifts/purchase'};
 assert.equal(nodes(PurchaseReturn({userId:'user'})).find(n=>n.type==='link').props.to,'/gifts/purchase');
});
test.after(()=>unlink('goods-purchase-check.mjs'));
