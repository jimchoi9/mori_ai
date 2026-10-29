import {useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Config} from '../../api/types';
import {GlassButton} from '../../components/ui/GlassButton';
import {usePrivateRequest} from '../generation/usePrivateRequest';
import type {GoodsDesign,TestPurchase} from './api';

export function useCheckoutConfig(){
 return useQuery({queryKey:['client-config'],queryFn:({signal})=>api<Config>('/client-config',{signal}),retry:false});
}

export function TestCheckout({design,userId}:{design:GoodsDesign;userId:string}){
 const config=useCheckoutConfig(),navigate=useNavigate(),cache=useQueryClient();
 const request=usePrivateRequest();
 const intent=useRef<{key:string;version:number;gift:boolean}|null>(null),locked=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[gift,setGift]=useState(false);
 const [completed,setCompleted]=useState<TestPurchase|null>(null);
 const purchase=completed??design.test_purchase;
 async function checkout(){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');
  intent.current??={key:crypto.randomUUID(),version:design.version,gift};
  try{
   const result=await api<TestPurchase>(`/goods/designs/${design.id}/test-checkout`,{
    method:'POST',body:{expected_version:intent.current.version,...(intent.current.gift?{gift:true}:{})},key:intent.current.key,signal:request.current.signal});
   if(request.current.signal.aborted)return;
   setCompleted(result);
   // Refetching caches must not turn a committed checkout into an apparent failure.
   void cache.invalidateQueries({queryKey:['goods-design',userId,design.id]});
   void cache.invalidateQueries({queryKey:['goods-designs',userId]});
   void cache.invalidateQueries({queryKey:['albums',userId]});
   if(result.album_status!=='deleted')navigate(`/purchases/${result.id}`);
  }catch(e){if(!request.current.signal.aborted)setError(errorText(e));}
  finally{locked.current=false;if(!request.current.signal.aborted)setBusy(false);}
 }
 if(purchase)return <section className="test-checkout" aria-label="테스트 구매">
  <p className="notice">전용 사진첩이 연결되었어요. 실제 결제·제작·배송은 진행되지 않습니다.</p>
  {purchase.album_status==='deleted'?<p>연결된 사진첩이 삭제되었습니다.</p>:
   <p>구매한 굿즈의 사진첩을 이어서 채워 보세요.</p>}
  <Link className="button-link" to={`/purchases/${purchase.id}`}>{purchase.album_status==='deleted'?'주문 내역 보기':'내 사진첩으로'}</Link>
 </section>;
 if(config.isPending)return <p role="status">구매 체험을 준비하고 있어요…</p>;
 if(config.isError)return <p role="alert">구매 체험 설정을 불러오지 못했어요. <button onClick={()=>void config.refetch()}>다시 확인</button></p>;
 if(config.data?.goods_checkout_mode!=='test'||design.album_id||design.production_started)return null;
 return <section className="test-checkout" aria-label="테스트 결제">
  <h2>굿즈에 담을 사진을 추가해 보세요</h2>
  <p>지금은 결제 없이 구매 이후 과정을 체험할 수 있어요. 버튼을 누르면 이 디자인의 사진첩이 자동으로 연결됩니다.</p>
  <label className="purchase-gift-option"><input type="checkbox" checked={gift} disabled={busy||!!intent.current} onChange={e=>setGift(e.target.checked)}/> 선물받는 사람이 사진을 채울 거예요</label>
  <GlassButton disabled={busy} onClick={()=>void checkout()}>{busy?'사진첩 준비 중…':'테스트 결제하고 사진 추가하기'}</GlassButton>
  <p className="hint">실제 요금 청구나 제작·배송 요청은 발생하지 않습니다.</p>
  {error&&<p role="alert">{error} <button disabled={busy} onClick={()=>void checkout()}>같은 요청 다시 시도</button></p>}
 </section>;
}
