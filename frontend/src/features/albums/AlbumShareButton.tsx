import {useEffect,useRef,useState} from 'react';
import {api,errorText} from '../../api/client';
import {checkedViewingLink,copyViewingLink,queueViewingLinkCopy} from './viewingLink';
import './albumShare.css';
interface Props {
 albumId:string;userId:string;disabled?:boolean;
 prepare:()=>boolean|Promise<boolean>;
 onBusyChange?:(busy:boolean)=>void;
 onOpenChange?:(open:boolean)=>void;
}
/** First click opts in and copies; repeated clicks reuse the exact same address. */
export function AlbumShareButton({albumId,userId,disabled=false,prepare,onBusyChange,onOpenChange}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[manual,setManual]=useState('');
 const link=useRef(''),flight=useRef(false),generation=useRef(0),request=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null),address=useRef<HTMLInputElement>(null);
 const callbacks=useRef({prepare,onBusyChange,onOpenChange});callbacks.current={prepare,onBusyChange,onOpenChange};
 const titleId=useRef(`album-share-${crypto.randomUUID()}`);
 useEffect(()=>{
  const clear=()=>{generation.current++;request.current?.abort();link.current='';flight.current=false;clearTimeout(timer.current);setBusy(false);setError('');setNotice('');setManual('');callbacks.current.onBusyChange?.(false);};
  clear();
  const events=['mori:logout','mori:session-expired','mori:clear-private-memory'];
  events.forEach(name=>window.addEventListener(name,clear));
  return()=>{clear();events.forEach(name=>window.removeEventListener(name,clear));};
 },[albumId,userId]);
 useEffect(()=>{
  if(!manual)return;
  const element=dialog.current!,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';element.showModal();closeButton.current?.focus({preventScroll:true});callbacks.current.onOpenChange?.(true);
  return()=>{element.close();document.body.style.overflow=overflow;callbacks.current.onOpenChange?.(false);if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};
 },[manual]);
 async function share(){
  if(disabled||flight.current)return;
  flight.current=true;setBusy(true);setError('');setNotice('');callbacks.current.onBusyChange?.(true);
  const epoch=generation.current,valid=()=>epoch===generation.current;
  const controller=new AbortController();request.current=controller;
  try{
   // Clean edits return synchronously so an existing link keeps the user's copy gesture.
   const prepared=callbacks.current.prepare();
   const pending=(async()=>{
    const saved=typeof prepared==='boolean'?prepared:await prepared;
    if(!valid())throw new DOMException('Cancelled','AbortError');
    if(!saved)throw new Error('변경사항을 저장하지 못했어요. 저장을 확인한 뒤 다시 눌러 주세요.');
    if(!link.current){
     const result=await api<{viewing_url:string}>(`/albums/${albumId}/viewing-link`,{method:'POST',body:{},signal:controller.signal});
     if(!valid())throw new DOMException('Cancelled','AbortError');
     link.current=checkedViewingLink(result.viewing_url);
    }
    return link.current;
   })();
   const queued=queueViewingLinkCopy(pending);
   const value=await pending;
   if(!valid())return;
   const copied=(queued&&await queued)||await copyViewingLink(value,queued!==null);
   if(!valid())return;
   if(copied){setNotice('감상 링크를 복사했어요.');clearTimeout(timer.current);timer.current=setTimeout(()=>setNotice(''),4200);}
   else setManual(link.current);
  }catch(cause){if(valid()&&!controller.signal.aborted)setError(errorText(cause));}
  finally{if(valid()){flight.current=false;setBusy(false);callbacks.current.onBusyChange?.(false);}}
 }
 return <><button ref={trigger} className="album-share-copy" type="button" disabled={disabled||busy} onClick={()=>void share()} title="링크를 받은 사람은 로그인 없이 이 앨범만 감상할 수 있어요.">{busy?'링크 준비 중…':'감상 링크 복사'}</button>
  {error&&<p className="album-share-error" role="alert">{error}</p>}
  {notice&&<div className="album-share-toast" role="status">{notice}</div>}
  <dialog ref={dialog} className="album-share-fallback" aria-labelledby={titleId.current} onCancel={event=>{event.preventDefault();setManual('');}} onClick={event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)setManual('');}}>
   {manual&&<><header><h2 id={titleId.current}>감상 링크가 준비됐어요</h2><button ref={closeButton} type="button" aria-label="감상 링크 닫기" onClick={()=>setManual('')}>×</button></header>
    <p>자동으로 복사하지 못했어요.<br/>주소를 선택해 직접 복사해 주세요.</p>
    <input ref={address} aria-label="감상 링크 주소" value={manual} readOnly onFocus={event=>event.currentTarget.select()}/>
    <button type="button" className="album-share-select" onClick={()=>{address.current?.focus({preventScroll:true});address.current?.select();address.current?.setSelectionRange(0,manual.length);}}>주소 선택</button>
    <p className="album-share-scope">링크를 받은 사람은 로그인 없이 이 앨범만 감상할 수 있어요. NFC에도 같은 링크를 사용해요.</p>
   </>}
  </dialog></>;
}
