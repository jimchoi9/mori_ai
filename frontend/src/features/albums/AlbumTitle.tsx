import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {api,ApiError,errorText} from '../../api/client';
import type {Album,Detail} from '../../api/types';
import './albumTitle.css';

/** Owner management only. Draft survives background refetch and save failures. */
export function AlbumTitle({album,userId,disabled=false}:{album:Album;userId:string;disabled?:boolean}){
 const cache=useQueryClient(),dialog=useRef<HTMLDialogElement>(null),controller=useRef<AbortController|null>(null);
 const [open,setOpen]=useState(false),[text,setText]=useState(''),[version,setVersion]=useState(0),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{if(!open)return;const d=dialog.current!;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';d.showModal();return()=>{d.close();document.body.style.overflow=overflow;};},[open]);
 useEffect(()=>{const clear=()=>{controller.current?.abort();setOpen(false);setText('');};window.addEventListener('mori:clear-private-memory',clear);window.addEventListener('mori:logout',clear);return()=>{controller.current?.abort();window.removeEventListener('mori:clear-private-memory',clear);window.removeEventListener('mori:logout',clear);};},[album.id,userId]);
 function edit(){setText(album.title);setVersion(album.version);setError('');setOpen(true);}
 async function save(event:React.FormEvent){
  event.preventDefault();if(saving)return;
  const normalized=text.normalize('NFC').trim();
  if(!normalized||Array.from(normalized).length>40){setError('앨범 이름은 1~40자로 입력해 주세요.');return;}
  const request=new AbortController();controller.current=request;setSaving(true);setError('');
  try{
   await api(`/albums/${album.id}/title`,{method:'PATCH',body:{expected_version:version,title:normalized},signal:request.signal});
   if(request.signal.aborted)return;setOpen(false);
   await Promise.all([cache.invalidateQueries({queryKey:['album',userId,album.id]}),cache.invalidateQueries({queryKey:['albums',userId]})]);
  }catch(e){if(request.signal.aborted)return;setError(errorText(e));if(e instanceof ApiError&&e.code==='VERSION_CONFLICT'){
   try{const fresh=await api<Detail>(`/albums/${album.id}`,{signal:request.signal});if(!request.signal.aborted){setVersion(fresh.detail.album.version);setError(`현재 제목은 ‘${fresh.detail.album.title}’입니다. 확인 후 다시 저장해 주세요.`);}}catch{/* Keep the draft and original version when refresh fails. */}
  }}finally{if(!request.signal.aborted)setSaving(false);}
 }
 return <><h1 className="album-title"><button type="button" aria-label={`${album.title}, 앨범 이름 바꾸기`} disabled={disabled} onClick={edit}><span>{album.title}</span><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/></svg></button></h1><dialog ref={dialog} className="album-title-dialog" aria-label="앨범 이름" onCancel={e=>{e.preventDefault();if(!saving)setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget&&!saving)setOpen(false);}}>{open&&<form onSubmit={event=>void save(event)}><h2>앨범 이름</h2><input aria-label="앨범 이름" autoFocus value={text} disabled={saving} onChange={e=>setText(e.target.value)}/>{error&&<p role="alert">{error}</p>}<div><button type="button" disabled={saving} onClick={()=>setOpen(false)}>취소</button><button type="submit" disabled={saving}>{saving?'저장 중…':'저장'}</button></div></form>}</dialog></>;
}
