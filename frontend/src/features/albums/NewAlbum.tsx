import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Album,Config} from '../../api/types';
import {requestIntents} from '../generation/flow';
import {usePrivateRequest} from '../generation/usePrivateRequest';
import {stageNewAlbumUploads} from '../uploads/useEasyUploads';
import '../uploads/easyUpload.css';
import '../content/content.css';

/** Entering this screen never creates or deletes an album. */
export function NewAlbum({userId}:{userId:string}){
 const navigate=useNavigate(),cache=useQueryClient(),request=usePrivateRequest();
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 const creating=useRef(false),[busy,setBusy]=useState(false),[files,setFiles]=useState<File[]>([]),[error,setError]=useState('');
 const max=config.data?.easy_upload?.max_photos??50;
 useEffect(()=>{
  const leave=(event:BeforeUnloadEvent)=>{if(files.length){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',leave);
  return()=>window.removeEventListener('beforeunload',leave);
 },[files.length]);
 async function start(selected:File[]){
  if(!selected.length||creating.current||!config.data?.album_content_enabled)return;
  setFiles(selected);setError('');
  if(selected.length>max){setError(`${max}장까지 담을 수 있어요. 사진을 다시 골라주세요.`);return;}
  creating.current=true;setBusy(true);
  const scope=`create-album:${userId}`,intent=requestIntents.get(scope,{});
  try{
   const {album}=await api<{album:Album}>('/albums',{method:'POST',body:intent.body,key:intent.key,signal:request.current.signal});
   if(request.current.signal.aborted)return;
   if(!album.content_enabled)throw new Error('사진 추가 기능을 확인한 뒤 다시 시도해 주세요.');
   stageNewAlbumUploads(userId,album.id,selected);
   requestIntents.finish(scope);
   void cache.invalidateQueries({queryKey:['albums',userId]}).catch(()=>undefined);
   // Files stay in the existing private tab queue, never in URL/history/storage.
   navigate(`/albums/${album.id}/manage`,{replace:true});
  }catch(cause){if(!request.current.signal.aborted)setError(errorText(cause));}
  finally{creating.current=false;if(!request.current.signal.aborted)setBusy(false);}
 }
 if(config.isError)return <section><p role="alert">{errorText(config.error)}</p><button onClick={()=>void config.refetch()}>다시 불러오기</button></section>;
 if(!config.data)return <p role="status">사진 추가 화면을 준비하고 있어요…</p>;
 if(!config.data.album_content_enabled)return <section><p>사진 추가 기능을 이용할 수 없어요.</p><Link to="/albums">내 앨범</Link></section>;
 return <section className="content-manager new-album-screen">
  <header className="content-heading"><Link className="easy-upload-back" to="/albums" aria-label="내 앨범">‹</Link><h1>새 앨범</h1><span aria-label={`저장된 사진 0장, 최대 ${max}장`}>0 / {max}</span></header>
  {error&&<p role="alert">{error}</p>}
  {files.length>0&&<p role="status">사진 {files.length}장을 골랐어요.{busy?' 앨범을 준비하고 있어요.':''}</p>}
  {!busy&&error&&files.length>0&&files.length<=max&&<button onClick={()=>void start(files)}>다시 시도</button>}
  <div className="content-empty"><p>사진을 추가해 주세요</p></div>
  <footer className="content-footer"><label className={`content-add${busy?' disabled':''}`}>＋ 사진 추가<input type="file" aria-label="사진 추가" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" disabled={busy} onChange={event=>{const selected=Array.from(event.target.files??[]);event.target.value='';if(selected.length)void start(selected);}}/></label><button className="content-edit" disabled>편집</button></footer>
 </section>;
}
