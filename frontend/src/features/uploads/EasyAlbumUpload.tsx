import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Detail} from '../../api/types';
import {albumPath} from '../generation/flow';
import {useEasyUploads} from './useEasyUploads';
import {UploadPhoto} from './UploadPhoto';
import {UploadInspector} from './UploadInspector';
import {photoFailed,photoReady,uploadMessages,type UploadPhotoEntry} from './uploadMessages';
import './easyUpload.css';

export function EasyAlbumUpload({userId,maxPhotos}:{userId:string;maxPhotos:20|50}){
 const {albumId=''}=useParams(),navigate=useNavigate(),cache=useQueryClient();
 const detail=useQuery({queryKey:['album',userId,albumId],queryFn:({signal})=>api<Detail>(`/albums/${albumId}`,{signal}),
  refetchInterval:query=>!document.hidden&&query.state.data?.detail.pages.some(page=>['reserved','validating'].includes(page.upload_status))?1800:false,
  refetchIntervalInBackground:false});
 const refresh=async()=>{await detail.refetch();await cache.invalidateQueries({queryKey:['albums',userId]});};
 const upload=useEasyUploads(albumId,userId,refresh,maxPhotos,detail.data?.detail.pages.map(page=>page.id)??[]);
 const [inspector,setInspector]=useState<string|null>(null),[error,setError]=useState(''),[removing,setRemoving]=useState(false);
 const [online,setOnline]=useState(navigator.onLine);
 const pendingScroll=useRef(false),logEnd=useRef<HTMLDivElement>(null);
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<{album_content_enabled?:boolean}>('/client-config',{signal})});
 const album=detail.data?.detail.album,pages=detail.data?.detail.pages??[];
 const {messages,attached}=uploadMessages(pages,upload.items.filter(item=>!item.replacesPageId),upload.batches);
 const inspected=inspector==='attached'?attached:messages.find(message=>message.id===inspector)?.photos??[];
 const pageIds=new Set(pages.map(page=>page.id));
 const count=pages.length+upload.items.filter(item=>!item.replacesPageId&&(!item.pageId||!pageIds.has(item.pageId))).length;
 const remaining=Math.max(0,maxPhotos-count),over=Math.max(0,count-maxPhotos);
 const locked=upload.busy||removing;
 const uploadError=error||(!over?upload.error:'');
 const media=(photo:UploadPhotoEntry)=>detail.data?.media_access.find(access=>access.asset_id===(photo.page?.thumbnail??photo.page?.source)?.asset_id);
 const reload=()=>{void detail.refetch();};
 useEffect(()=>{if(album&&!album.content_enabled&&album.status!=='draft')navigate(albumPath(album),{replace:true});},[album?.status,albumId,navigate]);
 useEffect(()=>{
  const connection=()=>setOnline(navigator.onLine),clear=()=>{setInspector(null);setError('');};
  window.addEventListener('online',connection);window.addEventListener('offline',connection);
  window.addEventListener('mori:logout',clear);window.addEventListener('mori:clear-private-memory',clear);
  return()=>{window.removeEventListener('online',connection);window.removeEventListener('offline',connection);window.removeEventListener('mori:logout',clear);window.removeEventListener('mori:clear-private-memory',clear);};
 },[]);
 useEffect(()=>{setInspector(null);setError('');},[albumId,userId]);
 useEffect(()=>{if(inspector&&!inspected.length)setInspector(null);},[inspector,inspected.length]);
 useEffect(()=>{
  if(!pendingScroll.current||!messages.length)return;
  pendingScroll.current=false;
  logEnd.current?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 },[messages.length]);

 async function send(ids:string[]){
  setError('');pendingScroll.current=true;await upload.send(ids);
 }
 async function remove(photo:UploadPhotoEntry){
  if(locked)return;
  if((photoReady(photo)||photo.page)&&!window.confirm('이 사진을 앨범에서 삭제할까요?'))return;
  setRemoving(true);setError('');
  try{
   if(photo.item)await upload.remove(photo.item);
   else if(photo.page){
    const fresh=await api<Detail>(`/albums/${albumId}`);
    await api(`/albums/${albumId}/pages/${photo.page.id}?expected_version=${fresh.detail.album.version}`,{method:'DELETE'});
    await refresh();
   }
  }catch(reason){setError(errorText(reason));}
  finally{setRemoving(false);}
 }
 if(detail.isPending)return <p role="status">사진첩을 불러오는 중…</p>;
 if(!detail.data)return <section><p role="alert">{errorText(detail.error)}</p><button type="button" onClick={reload}>다시 불러오기</button></section>;
 if(album?.status!=='draft'&&!album?.content_enabled)return <p role="status">사진첩으로 이동하고 있어요…</p>;
 return <section className="easy-upload-screen" aria-label="사진 보내기">
  <header className="easy-upload-heading">
   <Link className="easy-upload-back" to="/albums" aria-label="내 사진첩으로">‹</Link>
   <h1>{album.title}</h1><span>최대 {maxPhotos}장</span>
  </header>
  <div className="easy-message-log" aria-label="앨범 사진과 보낸 사진">
   {!pages.length&&!messages.length&&<div className="easy-guide" role="note">이 앨범에 사진을 골라 보내주세요.</div>}
   {messages.map(message=>{
    const ready=message.photos.filter(photoReady).length,failed=message.photos.filter(photoFailed).length;
    const retry=message.photos.filter(photo=>photo.item&&!photoReady(photo)).map(photo=>photo.item!.id);
    const waiting=ready<message.photos.length;
    const progress=waiting&&upload.busy&&retry.some(id=>upload.activeIds.includes(id));
    const transferring=message.photos.some(photo=>photo.item&&['selected','preparing','waiting','sending'].includes(photo.item.state)&&!photoReady(photo));
    const status=!waiting?`${ready}장 저장 완료`:!online?`연결 대기 · ${ready}/${message.photos.length} 저장`:
     failed?`${ready}장 저장 · ${message.photos.length-ready}장 확인 필요`:
     progress&&ready===0&&transferring?'사진 준비 중':progress&&transferring?`${ready}/${message.photos.length} 저장`:`저장 확인 중 · ${ready}/${message.photos.length}`;
    return <article className="easy-message" key={message.id} aria-label={`사진 ${message.photos.length}장 묶음`}>
     <div className="easy-message-mosaic">
      {message.photos.slice(0,4).map((photo,index)=><UploadPhoto key={photo.id} photo={photo} access={media(photo)} reload={reload}
       label={`사진 ${message.photos.length}장 묶음 확인`} onOpen={()=>setInspector(message.id)} overflow={index===3?message.photos.length-4:0}/>)}
     </div>
     {progress&&<progress aria-label="저장된 사진" value={ready} max={message.photos.length}/>}
     <p className="easy-message-status" role="status" aria-live="polite">{status}</p>
     {waiting&&!upload.busy&&retry.length>0&&<button type="button" className="easy-retry" disabled={removing} onClick={()=>void send(retry)}>{retry.length}장 다시 보내기</button>}
     {waiting&&!retry.length&&failed>0&&<p className="easy-photo-error">사진을 눌러 확인해주세요.</p>}
    </article>;
   })}
   <div ref={logEnd}/>
  </div>
  {uploadError&&!inspector&&<p className="easy-upload-error" role="alert">{uploadError}</p>}
  {(upload.busy||attached.length>0||remaining>0)&&<div className="easy-upload-actions">
   {attached.length>0&&<div className="easy-attachment-preview" aria-label={`선택한 사진 ${attached.length}장`}>
    {attached.slice(0,3).map((photo,index)=><UploadPhoto key={photo.id} photo={photo} reload={reload}
     label={`선택한 사진 ${attached.length}장 확인`} onOpen={()=>setInspector('attached')} overflow={index===2?attached.length-3:0}/>)}
   </div>}
   {over>0&&<p className="easy-upload-error" role="alert">{maxPhotos}장까지 · {over}장 빼주세요.</p>}
   {upload.busy?<p className="easy-upload-hint">저장이 끝날 때까지 열어두세요.</p>:<div className="easy-upload-composer">
    {remaining>0&&<label className={`easy-upload-add${locked?' disabled':''}${attached.length?' easy-upload-add--compact':''}`}>
     <span aria-hidden="true">＋</span>{!attached.length&&' 사진'}
     <input type="file" className="easy-upload-file" aria-label={attached.length?'사진 더 고르기':'사진 고르기'} multiple
      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" disabled={locked}
      onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';if(files.length)upload.select(files,remaining);}}/>
    </label>}
    {attached.length>0&&<button type="button" className="easy-upload-send" disabled={locked||over>0} onClick={()=>void send(attached.map(photo=>photo.item!.id))}>{attached.length}장 보내기</button>}
   </div>}
  </div>}
  {(album.content_enabled||config.data?.album_content_enabled)&&pages.length>0&&!upload.busy&&<Link className="content-review-link" to={`/albums/${albumId}/manage`}>사진·글귀 확인</Link>}
  <UploadInspector open={inspector!==null&&inspected.length>0} photos={inspected} onClose={()=>setInspector(null)} onRemove={photo=>void remove(photo)}
   disabled={locked} error={uploadError} media={media} reload={reload}/>
 </section>;
}
