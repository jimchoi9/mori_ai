import {useQuery} from '@tanstack/react-query';
import {Link, Navigate, useLocation, useParams} from 'react-router';
import {api,errorText} from '../../api/client';
import type {AlbumStatus,Config,Detail} from '../../api/types';
import {ScreenHeader} from '../../components/layout/ScreenHeader';
import './goods.css';

interface Purchase {
 id:string;design_id:string;mode:'test';created_at:string;album_id:string;album_status:AlbumStatus;
 product:'keyring'|'magnet';print_box_mm:number;image_url:string;delivery_status:string;
 gift:boolean;gift_registered:boolean;can_manage:boolean;files_ready:boolean;address_ready:boolean;link_expires_at:string|null;upload_url:string|null;
 files:Record<string,string>;
}
function usePurchase(id:string,userId:string){
 return useQuery({queryKey:['goods-purchase',userId,id],
  queryFn:({signal})=>api<Purchase>(`/goods/purchases/${id}`,{signal}),
  refetchInterval:q=>['pending','preparing','sending'].includes(q.state.data?.delivery_status??'')?5000:false});
}
export function PurchaseDetail({userId}:{userId:string}){
 const {purchaseId=''}=useParams();const query=usePurchase(purchaseId,userId),p=query.data;
 const location=useLocation(),orderDetails=new URLSearchParams(location.search).get('details')==='1';
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 const album=useQuery({queryKey:['purchase-album',userId,p?.album_id],enabled:!!p?.can_manage&&p.album_status!=='deleted'&&!!config.data?.album_content_enabled,
  queryFn:({signal})=>api<Detail>(`/albums/${p!.album_id}`,{signal})});
 if(!p)return <section className="purchase-detail"><ScreenHeader title="주문 내역"/>{query.isError?<p role="alert">{errorText(query.error)} <button onClick={()=>void query.refetch()}>다시 불러오기</button></p>:<p role="status">주문 내역을 불러오고 있어요…</p>}<Link to="/designs">내 디자인</Link></section>;
 const deleted=p.album_status==='deleted';
 const hasPhotos=(album.data?.detail.pages.length??0)>0;
 const managed=!!config.data?.album_content_enabled&&p.can_manage&&!deleted&&!['processing','action_required'].includes(p.album_status);
 if(!orderDetails&&managed&&album.isPending)return <p role="status">사진첩을 확인하고 있어요…</p>;
 if(!orderDetails&&managed&&hasPhotos)return <Navigate to={`/albums/${p.album_id}/manage`} replace/>;
 return <section className="purchase-detail">
  <Link className="purchase-back" to={`/designs/${p.design_id}`}>‹ 내 디자인</Link>
  <ScreenHeader title={orderDetails?'주문 내역':'구매가 완료됐어요'} subtitle={orderDetails?undefined:p.gift?'선물받는 분이 사진첩을 채울 수 있어요.':'사진을 담아 나만의 사진첩을 만들어 보세요.'}/>
  <div className="purchase-summary"><img src={p.image_url} alt="구매할 때 확정한 디자인"/><div><p className="eyebrow">{p.product==='magnet'?'마그네틱':'키링'}</p><h2>나만의 굿즈</h2><p>약 5 × 5 cm</p><p className="hint">{new Date(p.created_at).toLocaleDateString('ko-KR')} · 테스트 구매</p></div></div>
  {orderDetails&&<p className="hint purchase-order-id">주문번호 {p.id}</p>}
  {deleted?<p className="notice">연결된 사진첩이 삭제되었습니다. 구매 당시 디자인은 위에서 확인할 수 있어요.</p>:
   p.gift&&!p.can_manage?<p className="notice">{p.gift_registered?'선물받은 분의 앨범으로 등록되었어요.':'선물 QR을 전달해 주세요. 받는 분이 로그인 후 내 앨범 등록을 확정하면 사진을 채울 수 있어요.'}</p>:
   ['processing','action_required'].includes(p.album_status)?<Link className="button-link purchase-primary" to={`/albums/${p.album_id}/progress`}>사진첩 준비 현황 보기</Link>:
   managed&&hasPhotos?<Link className="button-link purchase-primary" to={`/albums/${p.album_id}/manage`}>사진첩 관리하기</Link>:
   p.album_status==='draft'||managed?<Link className="button-link purchase-primary" to={`/purchases/${p.id}/photos`}>사진 채우기</Link>:
   p.album_status==='review_ready'?<Link className="button-link purchase-primary" to={`/albums/${p.album_id}/review`}>사진 확인 이어가기</Link>:<p className="notice">사진첩이 완성되었어요. 굿즈에 휴대폰을 대고 감상해 주세요.</p>}
  {managed&&album.isError&&<p role="alert">사진첩 상태를 불러오지 못했어요. <button onClick={()=>void album.refetch()}>다시 확인</button></p>}
  {!deleted&&<details className="purchase-panel"><summary>{p.gift?'선물 등록 QR':'다른 휴대폰에서 사진 채우기'}</summary>
   {p.upload_url?<><img className="purchase-qr" src={p.files.qr} alt="사진 추가용 QR · 앨범 관리계정 로그인 필요"/>
    <p>{p.gift?'QR을 열고 로그인한 뒤 내 앨범 만들기를 확정해 주세요. 최초 확정 계정에 등록됩니다.':'QR을 열고 앨범 관리계정으로 로그인해 주세요.'}</p><p className="hint">감상용 NFC와는 다른 사진 관리 주소예요.</p>
    {p.link_expires_at&&<p className="hint">같은 Wi-Fi에서 사용하는 개발용 주소입니다. {new Date(p.link_expires_at).toLocaleString('ko-KR')}까지 유효하며, 주소가 바뀌면 여기서 새 QR을 받아 주세요.</p>}
    <a className="button-link secondary" href={p.files.qr} download="mori-upload-qr.png">QR 저장</a>
   </>:<p role="status">휴대폰 접속 주소를 준비 중이에요. 위의 사진 추가는 바로 이용할 수 있어요.</p>}
  </details>}
  {!orderDetails&&<Link className="purchase-back" to={`/purchases/${p.id}?details=1`}>구매한 굿즈·주문 내역</Link>}
  <p className="hint purchase-test-note">테스트 구매입니다. 실제 요금 청구·제작·배송은 진행되지 않습니다.</p>
 </section>;
}
export function PurchasePhotos({userId}:{userId:string}){
 const {purchaseId=''}=useParams();const query=usePurchase(purchaseId,userId),p=query.data;
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 if(config.isPending)return <p role="status">내 사진첩으로 이동하고 있어요…</p>;
 if(p?.can_manage&&config.data?.album_content_enabled&&p.album_status!=='deleted'&&!['processing','action_required'].includes(p.album_status))return <Navigate to={`/albums/${p.album_id}/manage`} replace/>;
 if(p?.album_status==='draft'&&p.can_manage)return <Navigate to={`/albums/${p.album_id}/edit`} replace/>;
 if(p)return <Navigate to={`/purchases/${p.id}`} replace/>;
 return <section className="purchase-detail">{query.isError?<p role="alert">{errorText(query.error)} <button onClick={()=>void query.refetch()}>다시 불러오기</button></p>:<p role="status">내 사진첩으로 이동하고 있어요…</p>}</section>;
}
/** Durable lookup works after QR entry, refresh, and on a different device. */
export function PurchaseReturn({userId}:{userId:string}){
 const location=useLocation();const id=location.pathname.match(/^\/albums\/([0-9a-f-]{36})\//)?.[1];
 const query=useQuery({queryKey:['album-purchase',userId,id],enabled:!!id,retry:false,
  queryFn:({signal})=>api<{purchase_id:string|null;return_path?:string|null}>(`/goods/purchases/by-album/${id}`,{signal})});
 const path=query.data?.return_path??`/purchases/${query.data?.purchase_id}`;
 return id&&query.data?.purchase_id?<p className="goods-return"><Link to={path.startsWith('/purchases/')?`${path}?details=1`:path}>‹ 구매한 굿즈·주문 내역</Link></p>:null;
}
