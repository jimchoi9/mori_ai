import {useEffect,useState} from 'react';
import {useLocation,useNavigate,useParams} from 'react-router';
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
export function GiftRegistration({userId,csrfToken,displayName}:{userId:string;csrfToken:string;displayName:string}){
 const {purchaseId=''}=useParams(),cache=useQueryClient(),location=useLocation(),navigate=useNavigate();
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
 useEffect(()=>{if(d?.status==='registered'&&d.album_id)navigate(d.album_status==='draft'?`/albums/${d.album_id}/edit`:`/albums/${d.album_id}/manage`,{replace:true});},[d?.status,d?.album_id,d?.album_status,navigate]);
 return <section className="purchase-detail"><ScreenHeader title="앨범 등록"/>
  {query.isPending&&<p role="status">선물 등록 정보를 확인하고 있어요…</p>}
  {(error||query.isError)&&<p role="alert">{error||'선물 QR을 다시 열어 주세요. 등록된 계정이라면 같은 계정으로 로그인해 주세요.'}</p>}
  {d?.status==='available'&&<><p><strong>{displayName?.trim()&&displayName!=='사용자'?`${displayName}님`:"현재 계정"}</strong>의 앨범으로 등록합니다.</p><GlassButton disabled={busy} onClick={()=>void claim()}>{busy?'등록 중…':'내 앨범에 등록'}</GlassButton></>}
  {d?.status==='registered'&&<p role="status">앨범을 여는 중…</p>}
  {d?.status==='claimed'&&<p>이미 다른 계정에 등록된 선물입니다. 등록한 계정으로 로그인해 주세요.</p>}
  {d?.status==='deleted'&&<p>연결된 사진첩이 삭제되었습니다.</p>}
 </section>;
}
