import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../../api/client';
import type {Detail,Page} from '../../../api/types';
import {usePrivateRequest} from '../../generation/usePrivateRequest';
import {placeBefore,projected,sameOrder} from './order';
export interface OrderActivity {gesture:boolean;writing:boolean}
interface Options {albumId:string;userId:string;pages:Page[];activity:{current:OrderActivity};allow:()=>boolean;flush:()=>Promise<boolean>;saved:()=>void;failed:()=>void}
/** Optimistic display, acknowledged server order, and transfer uncertainty have separate lifetimes. */
export function usePhotoOrder(options:Options){
 const cache=useQueryClient(),request=usePrivateRequest(),ctx=useRef(options);ctx.current=options;
 const alive=useRef(true),flight=useRef(false),ack=useRef<string|null>(null);
 const [preview,setPreview]=useState<string[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const pages=projected(options.pages,preview),view=useRef(pages);view.current=pages;
 const signature=options.pages.map(p=>p.id).join(',');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(preview&&ack.current===signature){ack.current=null;setPreview(null);}},[preview,signature]);
 useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),4500);return()=>clearTimeout(timer);},[message]);
 const valid=()=>alive.current&&!request.current.signal.aborted;
 async function move(id:string,before:string|null){
  if(flight.current||!valid()||!ctx.current.allow())return false;
  const ids=view.current.map(p=>p.id),optimistic=placeBefore(ids,id,before);
  if(!optimistic||sameOrder(ids,optimistic))return false;
  const current=ctx.current,key=['album',current.userId,current.albumId];
  let fresh:Detail|null=null,intended:string[]|null=null,sent=false;
  flight.current=true;current.activity.current.writing=true;ack.current=null;setBusy(true);setError('');setMessage('');setPreview(optimistic);
  const apply=(detail:Detail)=>{
   const accepted=detail.detail.pages.map(p=>p.id);ack.current=accepted.join(',');setPreview(accepted);
   cache.setQueryData<Detail>(key,{...detail,media_access:fresh?.media_access??detail.media_access});
   current.saved();if(!current.activity.current.gesture)setMessage(`사진을 ${accepted.indexOf(id)+1}번째로 옮겼어요.`);
   void cache.invalidateQueries({queryKey:['albums',current.userId]}).catch(()=>undefined);
  };
  try{
   if(!await current.flush())throw Error('글귀 저장을 확인한 뒤 순서를 다시 바꿔 주세요.');
   if(!valid())return false;
   await cache.cancelQueries({queryKey:key,exact:true});
   fresh=await api<Detail>(`/albums/${current.albumId}`,{signal:request.current.signal});if(!valid())return false;
   intended=placeBefore(fresh.detail.pages.map(p=>p.id),id,before);
   if(!intended)throw Error('사진 목록이 바뀌었어요. 현재 목록을 확인하고 다시 옮겨 주세요.');
   let result=fresh;
   if(!sameOrder(fresh.detail.pages.map(p=>p.id),intended)||fresh.detail.order_mode!=='manual'){
    sent=true;result=await api<Detail>(`/albums/${current.albumId}/page-order`,{method:'PUT',body:{expected_version:fresh.detail.album.version,page_ids:intended},signal:request.current.signal});
   }
   if(!valid())return false;apply(result);return true;
  }catch(e){
   if(!valid())return false;
   if(sent){
    const latest=await api<Detail>(`/albums/${current.albumId}`,{signal:request.current.signal}).catch(()=>null);if(!valid())return false;
    if(latest&&intended&&latest.detail.order_mode==='manual'&&sameOrder(latest.detail.pages.map(p=>p.id),intended)){fresh=latest;apply(latest);return true;}
    if(latest){fresh=latest;cache.setQueryData(key,latest);}
    current.failed();ack.current=null;setPreview(null);setError(latest?errorText(e):'순서 저장 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.');return false;
   }
   current.failed();if(fresh)cache.setQueryData(key,fresh);ack.current=null;setPreview(null);setError(errorText(e));return false;
  }finally{
   flight.current=false;current.activity.current.writing=false;if(valid())setBusy(false);
  }
 }
 return {pages,busy,error,message,move,dismiss:()=>setMessage('')};
}
