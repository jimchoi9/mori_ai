import {useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Album,Detail,MediaAccess} from '../../api/types';
import {removeAlbum} from './removeAlbum';
import {reviewDrafts} from '../review/drafts';
import './albumDelete.css';

interface Props {
 albumId:string;
 userId:string;
 albumTitle:string;
 disabled?:boolean;
 className?:string;
 pendingCount?:number;
 unsavedChanges?:boolean;
 onOpenChange?:(open:boolean)=>void;
 onDeleted:()=>void|Promise<void>;
}
/** Owner-only confirmation UI. Existing API ownership/version checks remain authoritative. */
export function AlbumDeleteButton({albumId,userId,albumTitle,disabled=false,className='',pendingCount=0,unsavedChanges=false,onOpenChange,onDeleted}:Props){
 const cache=useQueryClient(),navigate=useNavigate();
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),cancel=useRef<HTMLButtonElement>(null);
 const request=useRef<AbortController|null>(null),opened=useRef(false),flight=useRef(false),deleted=useRef(false),alive=useRef(true);
 const titleId=useRef(`album-delete-${crypto.randomUUID()}`),hintId=`${titleId.current}-hint`;
 const [open,setOpen]=useState(false),[detail,setDetail]=useState<Detail|null>(null),[word,setWord]=useState(''),[error,setError]=useState('');
 const [loading,setLoading]=useState(false),[deleting,setDeleting]=useState(false),[reviewRequired,setReviewRequired]=useState(false),[coverFailed,setCoverFailed]=useState(false);
 const callbacks=useRef({onOpenChange,onDeleted});callbacks.current={onOpenChange,onDeleted};
 const valid=(controller:AbortController)=>alive.current&&opened.current&&!controller.signal.aborted;
 function close(){
  if(flight.current)return;
  request.current?.abort();opened.current=false;setOpen(false);setWord('');setDetail(null);setError('');setReviewRequired(false);
  callbacks.current.onOpenChange?.(false);
 }
 useEffect(()=>{
  alive.current=true;
  const clear=()=>{request.current?.abort();opened.current=false;flight.current=false;setOpen(false);setWord('');setDetail(null);setError('');setDeleting(false);callbacks.current.onOpenChange?.(false);};
  window.addEventListener('mori:logout',clear);window.addEventListener('mori:clear-private-memory',clear);window.addEventListener('mori:session-expired',clear);
  const leave=(event:BeforeUnloadEvent)=>{if(flight.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',leave);
  return()=>{alive.current=false;request.current?.abort();window.removeEventListener('mori:logout',clear);window.removeEventListener('mori:clear-private-memory',clear);window.removeEventListener('mori:session-expired',clear);window.removeEventListener('beforeunload',leave);};
 },[albumId,userId]);
 useEffect(()=>{
  if(!open)return;
  const element=dialog.current!,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';element.showModal();cancel.current?.focus();
  return()=>{element.close();document.body.style.overflow=overflow;if(trigger.current?.isConnected)trigger.current.focus();};
 },[open]);
 async function load(){
  if(flight.current)return;
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setLoading(true);setWord('');setError('');setReviewRequired(true);setCoverFailed(false);
  try{
   const result=await api<Detail>(`/albums/${albumId}`,{signal:controller.signal});
   if(result.detail.album.id!==albumId||!Number.isInteger(result.detail.album.version)||result.detail.album.version<1)throw new Error('앨범 정보를 확인하지 못했어요. 다시 불러와 주세요.');
   if(valid(controller)){cache.setQueryData(['album',userId,albumId],result);setDetail(result);setReviewRequired(false);}
  }
  catch(cause){if(valid(controller))setError(errorText(cause));}
  finally{if(valid(controller))setLoading(false);}
 }
 function begin(){
  if(disabled||opened.current||deleted.current)return;
  opened.current=true;setOpen(true);setDetail(null);setWord('');setError('');callbacks.current.onOpenChange?.(true);void load();
 }
 const permitted=word.trim().normalize('NFC')==='삭제';
 async function confirm(){
  if(!detail||!permitted||disabled||loading||reviewRequired||flight.current||deleted.current)return;
  flight.current=true;setDeleting(true);setError('');
  const controller=new AbortController();request.current?.abort();request.current=controller;
  try{await removeAlbum(albumId,controller.signal,detail.detail.album.version);}
  catch(cause){
   if(valid(controller)){
    if((cause as {code?:string})?.code==='VERSION_CONFLICT'){setWord('');setReviewRequired(true);setError('앨범 내용이 바뀌었어요. 이름과 사진 수를 다시 확인해 주세요.');}
    else setError(errorText(cause));
    flight.current=false;setDeleting(false);
   }
   return;
  }
  if(!valid(controller))return;
  deleted.current=true;
  reviewDrafts.forget(userId,albumId);
  // A completed DELETE is never reported as failed because a later cache refresh failed.
  await cache.cancelQueries({queryKey:['album',userId,albumId],exact:true}).catch(()=>undefined);
  try{await callbacks.current.onDeleted();}catch{/* The server already acknowledged deletion. */}
  if(!valid(controller))return;
  cache.setQueriesData<{pages:Array<{items:Album[];media_access:MediaAccess[]}>}>({queryKey:['albums',userId]},old=>old?{...old,pages:old.pages.map(page=>{
   const removed=page.items.find(item=>item.id===albumId);
   return {...page,items:page.items.filter(item=>item.id!==albumId),media_access:page.media_access.filter(access=>access.asset_id!==removed?.cover?.asset_id)};
  })}:old);
  flight.current=false;setDeleting(false);close();
  navigate('/albums',{replace:true,state:{albumDeleted:true}});
  cache.removeQueries({queryKey:['album',userId,albumId],exact:true});
  void cache.invalidateQueries({queryKey:['albums',userId]}).catch(()=>undefined);
 }
 const album=detail?.detail.album,cover=album?.cover?detail?.media_access.find(item=>item.asset_id===album.cover?.asset_id):undefined;
 return <><button ref={trigger} type="button" className={`album-delete-link ${className}`} aria-label={`${albumTitle} 앨범 삭제`} disabled={disabled||deleting||deleted.current} onClick={begin}>앨범 삭제</button>
  <dialog ref={dialog} className="album-delete-dialog" aria-labelledby={titleId.current} aria-busy={loading||deleting} onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target!==event.currentTarget)return;const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}}>
   {open&&<><header><h2 id={titleId.current}>앨범을 삭제할까요?</h2><button type="button" className="album-delete-close" aria-label="삭제 취소하고 닫기" disabled={deleting} onClick={close}>×</button></header>
    {loading&&<p role="status">앨범 정보를 확인하고 있어요…</p>}
    {album&&<><div className="album-delete-summary">{cover&&!coverFailed?<img src={cover.url} alt="" referrerPolicy="no-referrer" onError={()=>setCoverFailed(true)}/>:<span className="album-delete-cover" aria-hidden="true">▤</span>}<div><h3>{album.title}</h3><p>사진 {album.page_count}장</p></div></div>
     <p>이 앨범과 담긴 사진을 다시 볼 수 없어요.</p><p className="album-delete-note">연결된 굿즈가 있다면, 그 굿즈에서도 이 앨범을 새로 열 수 없어요.</p>
     {(pendingCount>0||unsavedChanges)&&<p className="album-delete-note">{pendingCount>0?`저장되지 않은 사진 ${pendingCount}장도 함께 지워져요.`:'저장하지 않은 글귀 수정도 함께 지워져요.'}</p>}
     <label htmlFor={`${titleId.current}-word`}>삭제 확인</label><input id={`${titleId.current}-word`} type="text" value={word} disabled={loading||deleting||reviewRequired} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-describedby={hintId} onChange={event=>setWord(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent?.isComposing&&event.nativeEvent?.keyCode!==229)event.preventDefault();}}/><p id={hintId} className="album-delete-hint">위 칸에 ‘삭제’를 입력해 주세요.</p></>}
    {error&&<p role="alert" className="album-delete-error">{error}</p>}
    {reviewRequired&&!loading&&<button type="button" className="album-delete-review" onClick={()=>void load()}>최신 내용 다시 확인</button>}
    {disabled&&album&&!loading&&!deleting&&<p role="status">진행 중인 사진·글귀 작업이 끝나면 삭제할 수 있어요.</p>}
    <div className="album-delete-actions"><button ref={cancel} type="button" disabled={deleting} onClick={close}>취소</button><button type="button" className="album-delete-confirm" disabled={!album||!permitted||disabled||loading||deleting||reviewRequired} onClick={()=>void confirm()}>{deleting?'삭제 확인 중…':'앨범 삭제'}</button></div>
   </>}
  </dialog></>;
}
