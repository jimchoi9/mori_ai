import {useEffect,useState} from 'react';
import {Link,useLocation,useNavigate,useParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import {GlassButton} from '../../components/ui/GlassButton';
import {usePrivateRequest} from '../generation/usePrivateRequest';
import {ScreenHeader} from '../../components/layout/ScreenHeader';
const secretKey=(id:string)=>`mori:gift:${id}`;
/** Fragment never reaches HTTP logs or OAuth return_to. Retain only for this tab. */
export function GiftTokenCapture(){
 const location=useLocation(),navigate=useNavigate();
 useEffect(()=>{
  const id=location.pathname.match(/^\/gifts\/([0-9a-f-]{36})$/)?.[1];
  if(!id||!location.hash)return;
  const token=new URLSearchParams(location.hash.slice(1)).get('token');
  if(token&&/^[A-Za-z0-9_-]{43}$/.test(token))sessionStorage.setItem(secretKey(id),token);
  navigate(location.pathname,{replace:true});
 },[location.pathname,location.hash,navigate]);
 return null;
}
interface Registration {status:'available'|'registered'|'claimed'|'deleted';album_id:string|null;album_status?:string}
export function GiftRegistration({userId,csrfToken}:{userId:string;csrfToken:string}){
 const {purchaseId=''}=useParams(),cache=useQueryClient(),location=useLocation();
 const request=usePrivateRequest();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const token=()=>sessionStorage.getItem(secretKey(purchaseId));
 const key=['goods-gift',userId,purchaseId];
 const query=useQuery({queryKey:key,enabled:!location.hash,queryFn:({signal})=>api<Registration>(`/goods/purchases/${purchaseId}/gift/inspect`,{method:'POST',csrfToken,body:{token:token()},signal}),retry:false});
 async function claim(){
  if(busy)return;setBusy(true);setError('');
  try{
   const result=await api<Registration>(`/goods/purchases/${purchaseId}/gift/claim`,{method:'POST',csrfToken,body:{token:token()},signal:request.current.signal});
   if(request.current.signal.aborted)return;
   cache.setQueryData(key,result);
   if(result.status==='registered'){sessionStorage.removeItem(secretKey(purchaseId));void cache.invalidateQueries({queryKey:['albums',userId]});}
  }catch(e){if(!request.current.signal.aborted)setError(errorText(e));}finally{if(!request.current.signal.aborted)setBusy(false);}
 }
 const d=query.data;
 return <section className="purchase-detail"><ScreenHeader title="선물에 추억을 담아 주세요" subtitle="나만의 사진첩으로 등록해요."/>
  {query.isPending&&<p role="status">선물 등록 정보를 확인하고 있어요…</p>}
  {(error||query.isError)&&<p role="alert">{error||'선물 QR을 다시 열어 주세요. 등록된 계정이라면 같은 계정으로 로그인해 주세요.'}</p>}
  {d?.status==='available'&&<><p>지금 로그인한 계정에 이 사진첩을 등록할까요?</p><p className="hint">처음 등록을 확정한 계정에서 사진을 관리합니다. QR을 열거나 로그인한 것만으로 등록되지는 않아요.</p><GlassButton disabled={busy} onClick={()=>void claim()}>{busy?'등록 중…':'내 앨범 만들기'}</GlassButton></>}
  {d?.status==='registered'&&<><p>내 사진첩으로 등록되었어요.</p>{d.album_status==='draft'?<Link className="button-link purchase-primary" to={`/albums/${d.album_id}/edit`}>사진 추가하기</Link>:<p>사진첩을 준비했어요. 내 책장에서 관리 상태를 확인할 수 있어요.</p>}<Link to="/albums">내 책장</Link></>}
  {d?.status==='claimed'&&<p>이미 다른 계정에 등록된 선물입니다. 등록한 계정으로 로그인해 주세요.</p>}
  {d?.status==='deleted'&&<p>연결된 사진첩이 삭제되었습니다.</p>}
 </section>;
}
