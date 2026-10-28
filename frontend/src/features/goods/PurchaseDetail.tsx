import {useQuery} from '@tanstack/react-query';
import {Link, Navigate, useLocation, useParams} from 'react-router';
import {api,errorText} from '../../api/client';
import type {AlbumStatus,Config} from '../../api/types';
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
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 if(!p)return <section className="purchase-detail"><ScreenHeader title="구매 자료"/>{query.isError?<p role="alert">{errorText(query.error)} <button onClick={()=>void query.refetch()}>다시 불러오기</button></p>:<p role="status">구매 자료를 불러오고 있어요…</p>}<Link to="/designs">내 디자인</Link></section>;
 const deleted=p.album_status==='deleted';
 return <section className="purchase-detail">
  <Link className="purchase-back" to={`/designs/${p.design_id}`}>‹ 내 디자인</Link>
  <ScreenHeader title="굿즈에 추억을 담아 주세요" subtitle="이 굿즈만의 사진첩을 준비했어요."/>
  <div className="purchase-summary"><img src={p.image_url} alt="구매할 때 확정한 원화"/><div><p className="eyebrow">{p.product==='magnet'?'마그네틱':'키링'}</p><h2>나만의 굿즈</h2><p>약 5 × 5 cm · 그림 비율 유지</p><p className="hint">{new Date(p.created_at).toLocaleDateString('ko-KR')} · 테스트 구매</p></div></div>
  {deleted?<p className="notice">연결된 사진첩이 삭제되었습니다. 구매 당시 디자인 자료는 아래에서 확인할 수 있어요.</p>:
   p.gift&&!p.can_manage?<p className="notice">{p.gift_registered?'선물받은 분의 앨범으로 등록되었어요.':'선물 QR을 전달해 주세요. 받는 분이 로그인 후 내 앨범 등록을 확정하면 사진을 채울 수 있어요.'}</p>:
   p.album_status==='draft'?<Link className="button-link purchase-primary" to={`/purchases/${p.id}/photos`}>사진 추가하기</Link>:
   ['processing','action_required'].includes(p.album_status)?<Link className="button-link purchase-primary" to={`/albums/${p.album_id}/progress`}>사진첩 준비 현황 보기</Link>:
   config.data?.album_content_enabled&&p.can_manage?<Link className="button-link purchase-primary" to={`/albums/${p.album_id}/manage`}>사진·글귀 확인</Link>:p.album_status==='review_ready'?<Link className="button-link purchase-primary" to={`/albums/${p.album_id}/review`}>사진 확인 이어가기</Link>:<p className="notice">사진첩이 완성되었어요. 확정 자료와 QR은 여기서 다시 확인할 수 있어요.</p>}
  {!deleted&&<details className="purchase-panel"><summary>{p.gift?'선물 등록 QR':'다른 휴대폰에서 사진 채우기'}</summary>
   {p.upload_url?<><img className="purchase-qr" src={p.files.qr} alt="사진 추가용 QR · 앨범 관리계정 로그인 필요"/>
    <p>{p.gift?'QR을 열고 로그인한 뒤 내 앨범 만들기를 확정해 주세요. 최초 확정 계정에 등록됩니다.':'QR을 열고 앨범 관리계정으로 로그인해 주세요.'}</p><p className="hint">감상용 NFC와는 다른 사진 관리 주소예요.</p>
    {p.link_expires_at&&<p className="hint">같은 Wi-Fi에서 사용하는 개발용 주소입니다. {new Date(p.link_expires_at).toLocaleString('ko-KR')}까지 유효하며, 주소가 바뀌면 여기서 새 QR을 받아 주세요.</p>}
    <a className="button-link secondary" href={p.files.qr} download="mori-upload-qr.png">QR 저장</a>
   </>:<p role="status">휴대폰 접속 주소를 준비 중이에요. 위의 사진 추가는 바로 이용할 수 있어요.</p>}
  </details>}
  <details className="purchase-panel"><summary>확정 디자인·제작 자료</summary>
   <p className="hint">원화와 고리 위치 안내는 별도 파일이에요. 인쇄에는 원화 PNG를 사용해 주세요.</p>
   <div className="purchase-files"><a href={p.files.original??`/api/v1/goods/purchases/${p.id}/files/original`} download>원화 PNG</a>
    {p.address_ready&&p.files.sheet&&<><a href={p.files.preview} download>배치 안내 PNG</a><a href={p.files.sheet} download>A4 제작 PDF</a><a href={p.files.spec} download>확정 정보</a></>}
   </div><p className="hint">{p.delivery_status==='accepted'?'제작 자료를 메일 서비스에 전달했어요.':p.delivery_status==='failed'||p.delivery_status==='unknown'?'제작 자료 전달을 확인하고 있어요. 사진첩은 계속 이용할 수 있어요.':'제작 자료 전달을 준비하고 있어요.'}</p>
  </details>
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
 return id&&query.data?.purchase_id?<p className="goods-return"><Link to={query.data.return_path??`/purchases/${query.data.purchase_id}`}>‹ 굿즈·구매 자료로 돌아가기</Link></p>:null;
}
