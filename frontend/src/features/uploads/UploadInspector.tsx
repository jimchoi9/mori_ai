import {useEffect,useRef,useState} from 'react';
import type {MediaAccess} from '../../api/types';
import {UploadPhoto} from './UploadPhoto';
import type {UploadPhotoEntry} from './uploadMessages';

export function UploadInspector({photos,open,onClose,onRemove,disabled,error,media,reload,readOnly=false,initialPhotoId}:{
 readOnly?:boolean;initialPhotoId?:string;
 photos:UploadPhotoEntry[];open:boolean;onClose:()=>void;onRemove:(photo:UploadPhotoEntry)=>void;
 disabled:boolean;error:string;media:(photo:UploadPhotoEntry)=>MediaAccess|undefined;reload:()=>void;
}){
 const ref=useRef<HTMLDialogElement>(null);
 const [focused,setFocused]=useState<string|null>(null);
 useEffect(()=>{
  const dialog=ref.current;if(!open||!dialog)return;
  setFocused(initialPhotoId??null);
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';
  dialog.showModal();
  return()=>{dialog.close();document.body.style.overflow=previous;};
 },[open]);
 const current=photos.find(photo=>photo.id===focused);
 return <dialog ref={ref} className="easy-inspector" aria-label="앨범 사진 확인" onCancel={event=>{event.preventDefault();onClose();}}
  onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
  {open&&<div className="easy-inspector-content">
   <header className="easy-inspector-heading">
    {current?<button type="button" className="easy-inspector-back" onClick={()=>setFocused(null)}>사진 목록</button>:<strong>사진 {photos.length}장</strong>}
    <button type="button" className="easy-inspector-close" aria-label="사진 확인 닫기" onClick={onClose}>×</button>
   </header>
   {error&&<p role="alert">{error}</p>}
   {current?<div className="easy-photo-detail">
    <UploadPhoto photo={current} access={media(current)} label="선택한 사진" large reload={reload}/>
    {current.item?.error&&<p role="alert">{current.item.error}</p>}
    {['rejected','expired'].includes(current.page?.upload_status??'')&&!current.item&&<p role="alert">이 사진은 다시 골라주세요.</p>}
    {!readOnly&&<button type="button" className="easy-inspector-delete" disabled={disabled} onClick={()=>onRemove(current)}>{current.item&&!current.item.submitted?'선택 해제':'사진 삭제'}</button>}
   </div>:<ul className="easy-inspector-grid">
    {photos.map((photo,index)=><li key={photo.id}>
     <UploadPhoto photo={photo} access={media(photo)} label={`${index+1}번째 사진`} reload={reload}
      onOpen={()=>setFocused(photo.id)} onRemove={readOnly?undefined:()=>onRemove(photo)} disabled={disabled}/>
     {photo.item?.error&&<p className="easy-photo-error">{photo.item.error}</p>}
     {['rejected','expired'].includes(photo.page?.upload_status??'')&&!photo.item&&<p className="easy-photo-error">다시 골라주세요.</p>}
    </li>)}
   </ul>}
  </div>}
 </dialog>;
}
