import {useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Detail,Page,MediaAccess} from '../../api/types';
import {ScreenHeader} from '../../components/layout/ScreenHeader';
import {albumPath} from '../generation/flow';
import {useEasyUploads} from './useEasyUploads';
import type {TransferItem} from './easyTransport';
import {previewPhoto} from './photoDecoder';
import './easyUpload.css';

const stateText={selected:'선택됨',preparing:'사진 준비 중',waiting:'보낼 차례를 기다려요',sending:'보내는 중',checking:'저장 확인 중',saved:'저장 완료',failed:'다시 확인할 사진'};
function SelectedPhoto({item,remove,disabled}:{item:TransferItem;remove:()=>void;disabled:boolean}){
 const [url,setUrl]=useState('');
 useEffect(()=>{const controller=new AbortController();let url='';void previewPhoto(item.file,controller.signal).then(blob=>{if(!controller.signal.aborted){url=URL.createObjectURL(blob);setUrl(url);}}).catch(()=>undefined);return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};},[item.file]);
 return <li className={`easy-photo easy-photo--${item.state}`}><div className="easy-photo-image">{url?<img src={url} alt={item.file.name}/>:<div className="easy-photo-placeholder">사진</div>}<span>{stateText[item.state]}</span><button type="button" className="easy-photo-remove" disabled={disabled} aria-label={`${item.file.name} 선택 해제`} onClick={remove}>×</button></div>{item.error&&<p className="easy-photo-error">{item.error}</p>}</li>;
}
function SavedPhoto({page,access,reload}:{page:Page;access?:MediaAccess;reload:()=>void}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[access?.url]);
 return <div className="easy-photo"><div className="easy-photo-image">{access&&!failed?<img src={access.url} alt={`${page.position}번째 저장한 사진`} loading="lazy" onError={()=>{setFailed(true);reload();}}/>:<div className="easy-photo-placeholder">사진</div>}<span>{page.upload_status==='ready'?'저장 완료':page.upload_status==='validating'?'저장 확인 중':page.upload_status==='reserved'?'전송 대기':'저장 확인 필요'}</span></div></div>;
}
export function EasyAlbumUpload({userId,maxPhotos}:{userId:string;maxPhotos:20|50}){
 const {albumId=''}=useParams(),navigate=useNavigate(),cache=useQueryClient();
 const detail=useQuery({queryKey:['album',userId,albumId],queryFn:({signal})=>api<Detail>(`/albums/${albumId}`,{signal}),
  refetchInterval:q=>!document.hidden&&q.state.data?.detail.pages.some(p=>['reserved','validating'].includes(p.upload_status))?1800:false,refetchIntervalInBackground:false});
 const upload=useEasyUploads(albumId,userId,async()=>{await detail.refetch();await cache.invalidateQueries({queryKey:['albums',userId]});},maxPhotos,detail.data?.detail.pages.map(page=>page.id)??[]);
 const [error,setError]=useState('');
 const album=detail.data?.detail.album;
 useEffect(()=>{if(album&&album.status!=='draft')navigate(albumPath(album),{replace:true});},[album?.status,albumId,navigate]);
 if(detail.isPending)return <p role="status">사진첩을 불러오는 중…</p>;
 if(!detail.data)return <section><p role="alert">{errorText(detail.error)}</p><button onClick={()=>void detail.refetch()}>다시 불러오기</button></section>;
 if(album?.status!=='draft')return <p role="status">사진첩으로 이동하고 있어요…</p>;
 const data=detail.data,pages=data.detail.pages;
 const pageIds=new Set(pages.map(page=>page.id));
 const staged=upload.items.filter(item=>item.state!=='saved'||!item.pageId||!pageIds.has(item.pageId));
 const pending=staged.filter(item=>item.state!=='saved');
 const count=pages.length+staged.filter(item=>!item.pageId||!pageIds.has(item.pageId)).length;
 const remaining=Math.max(0,maxPhotos-count);
 const stagedIds=new Set(staged.map(item=>item.pageId));
 const saved=pages.filter(page=>!stagedIds.has(page.id));
 const ready=pages.filter(page=>page.upload_status==='ready').length+staged.filter(item=>item.state==='saved').length;
 const failures=staged.filter(item=>item.state==='failed').length;
 const sent=upload.items.filter(item=>item.transferred||item.state==='saved').length;
 async function removeSaved(page:Page){
  setError('');try{const fresh=await api<Detail>(`/albums/${albumId}`);await api(`/albums/${albumId}/pages/${page.id}?expected_version=${fresh.detail.album.version}`,{method:'DELETE'});await detail.refetch();}catch(e){setError(errorText(e));}
 }
 return <section className="easy-upload-screen">
  <Link className="easy-upload-back" to="/albums">‹ 내 사진첩</Link>
  <ScreenHeader title="추억을 담아 주세요" subtitle="사진을 고르고 보내면, 알아서 준비할게요."/>
  <div className="easy-upload-heading"><strong>사진 {count} / {maxPhotos}장</strong><span>{ready>0?`${ready}장 저장됨`:'좋아하는 순간을 골라 주세요'}</span></div>
  {count===0&&<div className="easy-upload-empty"><span aria-hidden="true">▧</span><h2>함께한 순간을 담아 보세요</h2><p>여러 장을 한 번에 골라도 괜찮아요.</p></div>}
  <ul className="easy-photo-grid" aria-label="앨범 사진과 보낼 사진">
   {saved.map(page=><li className="easy-saved-wrapper" key={page.id}><SavedPhoto page={page} access={data.media_access.find(a=>a.asset_id===(page.thumbnail??page.source)?.asset_id)} reload={()=>void detail.refetch()}/><button type="button" disabled={upload.busy} className="easy-saved-remove" aria-label={`${page.position}번째 저장한 사진 삭제`} onClick={()=>{if(window.confirm('이 사진을 앨범에서 삭제할까요?'))void removeSaved(page);}}>×</button></li>)}
   {staged.map(item=><SelectedPhoto key={item.id} item={item} disabled={upload.busy} remove={()=>void upload.remove(item)}/>)}
  </ul>
  {(upload.error||error)&&<p role="alert">{upload.error||error}</p>}
  <div className="easy-upload-actions">
   {upload.busy?<div role="status" aria-live="polite"><strong>{staged.some(item=>item.state==='checking')?'사진 저장을 확인하고 있어요':'사진을 보내고 있어요'}</strong><p>{upload.items.length}장 중 {sent}장 전송 · {upload.items.filter(item=>item.state==='saved').length}장 저장 확인</p><progress max={Math.max(1,upload.items.length)} value={upload.items.filter(item=>item.state==='saved').length}/></div>:
    pending.length?<button type="button" className="mori-button mori-button--primary" disabled={count>maxPhotos} onClick={()=>void upload.send()}>{failures===pending.length?'남은 사진 다시 보내기':`${pending.length}장 보내기`}</button>:
    ready>0?<p className="easy-upload-complete" role="status">{ready}장의 사진을 저장했어요.</p>:null}
   <label className={`easy-upload-add${upload.busy||!remaining?' disabled':''}`}>＋ 사진 고르기<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" disabled={upload.busy||!remaining} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';upload.select(files,remaining);}}/></label>
   <p className="easy-upload-hint">사진 화질과 크기는 자동으로 준비해요. 전송이 끝날 때까지 이 화면을 열어 두세요.</p>
  </div>
 </section>;
}
