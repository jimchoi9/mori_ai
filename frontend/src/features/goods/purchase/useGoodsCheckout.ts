import {useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../../api/client';
import type {Config} from '../../../api/types';
import {usePrivateRequest} from '../../generation/usePrivateRequest';
import type {GoodsDesign,TestPurchase} from '../api';

export function useCheckoutConfig(){
 return useQuery({queryKey:['client-config'],queryFn:({signal})=>api<Config>('/client-config',{signal}),retry:false});
}

/** A committed design precedes checkout; an uncertain request always replays its frozen intent. */
export function useGoodsCheckout(userId:string){
 const navigate=useNavigate(),cache=useQueryClient(),request=usePrivateRequest();
 const intent=useRef<{id:string;key:string;version:number;gift:boolean}|null>(null),locked=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[completed,setCompleted]=useState<TestPurchase|null>(null);
 async function checkout(design:GoodsDesign,gift:boolean){
  if(locked.current||request.current.signal.aborted)return null;
  if(completed)return completed;
  if(intent.current&&intent.current.id!==design.id){setError('진행 중인 구매 결과를 먼저 확인해 주세요.');return null;}
  locked.current=true;setBusy(true);setError('');
  intent.current??={id:design.id,key:crypto.randomUUID(),version:design.version,gift};
  const sent=intent.current;
  try{
   const result=await api<TestPurchase>(`/goods/designs/${sent.id}/test-checkout`,{
    method:'POST',body:{expected_version:sent.version,...(sent.gift?{gift:true}:{})},key:sent.key,signal:request.current.signal});
   if(request.current.signal.aborted)return null;
   setCompleted(result);
   for(const queryKey of [['goods-design',userId,sent.id],['goods-designs',userId],['albums',userId]])void cache.invalidateQueries({queryKey}).catch(()=>undefined);
   if(result.album_status!=='deleted'){
    if(sent.gift)navigate(`/purchases/${result.id}`);
    else navigate(`/purchases/${result.id}/photos`,{state:{purchaseCompleted:{userId,purchaseId:result.id}}});
   }
   return result;
  }catch(e){if(!request.current.signal.aborted)setError(errorText(e));return null;}
  finally{locked.current=false;if(!request.current.signal.aborted)setBusy(false);}
 }
 return {checkout,busy,error,completed,attempted:!!intent.current,aborted:()=>request.current.signal.aborted};
}
