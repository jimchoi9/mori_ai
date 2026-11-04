import {AlbumSaveState,AlbumUploadActivity,PhotoAddButton} from './AlbumUploadActivity';
import {AlbumTitle} from '../albums/AlbumTitle';
import {albumMeta} from '../albums/albumMeta';
import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Config,Detail,Page} from '../../api/types';
import {albumPath} from '../generation/flow';
import {UploadPhoto} from '../uploads/UploadPhoto';
import {UploadInspector} from '../uploads/UploadInspector';
import {useEasyUploads} from '../uploads/useEasyUploads';
import {useCaptionEdits} from './useCaptionEdits';
import {usePhotoReorder} from './usePhotoReorder';
import {usePhotoOrder} from './reorder/usePhotoOrder';
import '../uploads/easyUpload.css';
import './content.css';
const noPages:Page[]=[];
export function ContentManager({userId}:{userId:string}){
 const {albumId=''}=useParams(),navigate=useNavigate(),cache=useQueryClient();
 const activity=useRef({gesture:false,writing:false}),stopDrag=useRef(()=>{});
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 const query=useQuery({queryKey:['album',userId,albumId],enabled:!!config.data,retry:false,
  queryFn:async({signal})=>{const d=await api<Detail>(`/albums/${albumId}`,{signal});return !d.detail.album.content_enabled&&config.data?.album_content_enabled?api<Detail>(`/albums/${albumId}/content`,{method:'POST',body:{},signal}):d;},
  refetchOnWindowFocus:()=>!activity.current.gesture&&!activity.current.writing,
  refetchOnReconnect:()=>!activity.current.gesture&&!activity.current.writing,
  refetchInterval:q=>!activity.current.gesture&&!activity.current.writing&&!document.hidden&&(q.state.data?.detail.album.title_pending||q.state.data?.detail.pages.some(p=>['reserved','validating'].includes(p.upload_status)||p.caption_text===null&&['waiting','queued','running'].includes(p.caption_status??'')))?1800:false});
 const storedPages=query.data?.detail.pages??noPages,album=query.data?.detail.album;
 const refresh=async()=>{await query.refetch();await cache.invalidateQueries({queryKey:['albums',userId]});};
 const upload=useEasyUploads(albumId,userId,refresh,config.data?.easy_upload?.max_photos??50,storedPages.map(p=>p.id));
 const edits=useCaptionEdits(albumId,storedPages,refresh);
 const [editing,setEditing]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<string|null>(null),[menu,setMenu]=useState<string|null>(null);
 const [edited,setEdited]=useState(false),[finishing,setFinishing]=useState(false);
 const list=useRef<HTMLOListElement>(null),replacement=upload.items.filter(i=>i.replacesPageId&&i.state!=='saved');
 const allowOrder=()=>!busy&&!upload.busy&&!finishing&&!storedPages.some(p=>['reserved','validating'].includes(p.upload_status));
 const order=usePhotoOrder({albumId,userId,pages:storedPages,activity,allow:allowOrder,flush:edits.flush,saved:()=>{if(editing)setEdited(true);},failed:()=>stopDrag.current()});
 const pages=order.pages,locked=busy||upload.busy||finishing||order.busy;
 const drag=usePhotoReorder(list,{ids:pages.map(p=>p.id),allowed:allowOrder,blocked:()=>locked||edits.saving>0,
  phase:interacting=>{activity.current.gesture=interacting;},arm:()=>{order.dismiss();setMenu(null);},
  drop:(id,before)=>{void order.move(id,before);},handleTap:id=>setMenu(current=>current===id?null:id)});
 stopDrag.current=drag.stop;
 const controlsLocked=locked||drag.interacting;
 const media=(page:Page)=>query.data?.media_access.find(a=>a.asset_id===(page.thumbnail??page.source)?.asset_id);
 useEffect(()=>{if(album&&!album.content_enabled&&!config.data?.album_content_enabled)navigate(albumPath(album),{replace:true});},[album?.content_enabled,config.data?.album_content_enabled]);
 async function mutate(operation:(fresh:Detail)=>Promise<unknown>){if(controlsLocked)return;drag.stop();setBusy(true);setError('');try{if(!await edits.flush())return;const fresh=await api<Detail>(`/albums/${albumId}`);await operation(fresh);if(editing)setEdited(true);await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function move(from:string,to:string){if(from===to||controlsLocked)return;const ids=pages.map(p=>p.id),target=ids.indexOf(to),rest=ids.filter(id=>id!==from);setMenu(null);await order.move(from,rest[target]??null);}
 async function toggle(){
  if(controlsLocked)return;
  if(!editing){setEdited(false);setEditing(true);return;}
  if(replacement.length){setError('사진 교체가 아직 저장되지 않았어요. 다시 시도하거나 취소해 주세요.');return;}
  setFinishing(true);
  try{if(!await edits.flush())return;drag.stop();setMenu(null);setEditing(false);}finally{setFinishing(false);}
 }
 const captionFailed=Object.values(edits.drafts).some(d=>d.error||d.conflict);
 const selected=pages.find(p=>p.id===preview);
 const count=pages.length,savedCount=pages.filter(p=>p.upload_status==='ready').length,max=config.data?.easy_upload?.max_photos??50;
 if(config.isError||query.isError)return <section><p role="alert">{errorText(config.error??query.error)}</p><button onClick={()=>void query.refetch()}>다시 불러오기</button></section>;
 if(!album)return <p role="status">사진·글귀를 불러오는 중…</p>;
 return <section className="content-manager">
  <header className="content-heading"><Link className="easy-upload-back" to="/albums" aria-label="내 앨범으로 돌아가기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg><span>내 앨범</span></Link><AlbumTitle album={album} userId={userId} disabled={controlsLocked}/><span aria-label={`저장된 사진 ${savedCount}장, 최대 ${max}장`}>{savedCount} / {max}</span></header>
  <p className="album-capture-period">{albumMeta(album)}</p>
  <div className="content-order-controls">{album.content_ready&&<Link className="content-watch" to={`/albums/${albumId}/view`} onClick={e=>{if(controlsLocked||edits.dirty||edits.saving){e.preventDefault();setError('저장이 끝난 뒤 감상해 주세요.');}}}>감상하기 →</Link>}<label className="content-sort"><span className="sr-only">사진 정렬</span><select aria-label="사진 정렬" value={query.data?.detail.order_mode??'date'} disabled={controlsLocked||pages.some(p=>['reserved','validating'].includes(p.upload_status))} onChange={e=>{const mode=e.target.value;void mutate(fresh=>api(`/albums/${albumId}/${mode==='date'?'date-order':'manual-order'}`,{method:'POST',body:{expected_version:fresh.detail.album.version}}));}}><option value="date">촬영순</option><option value="manual">직접 배치</option></select></label></div>
  <AlbumUploadActivity upload={upload} pages={pages} max={max} canLeave={!editing&&!controlsLocked&&!edits.dirty&&!edits.saving}/>
  {(error||order.error)&&<p role="alert">{error||order.error}</p>}
  {replacement.map(item=><div key={item.id} className="content-replacement" role="status">{upload.busy?'사진을 바꾸고 있어요.':<>{item.error??'사진 교체를 확인해주세요.'}<button onClick={()=>void upload.send([item.id])}>다시 시도</button><button onClick={()=>void upload.remove(item)}>취소</button></>}</div>)}
  {!count&&!upload.busy&&<div className="content-empty"><p>사진을 추가해 주세요</p></div>}
  <ol ref={list} className="content-pages">{pages.map((page,index)=>{
   const draft=edits.drafts[page.id],photo={id:page.id,page};
   return <li key={page.id} data-page={page.id}>
    <div className="content-photo"><UploadPhoto photo={photo} access={media(page)} label={`${index+1}번째 사진 확인`} reload={()=>void query.refetch()} onOpen={!editing?()=>setPreview(page.id):undefined}/><span className="content-number">{index+1}</span>
     {editing&&<><button className="content-remove" aria-label={`${index+1}번째 사진 삭제`} disabled={controlsLocked} onClick={()=>{if(window.confirm('이 사진을 앨범에서 삭제할까요?'))void mutate(fresh=>api(`/albums/${albumId}/pages/${page.id}?expected_version=${fresh.detail.album.version}`,{method:'DELETE'}));}}>−</button>
      <label className={`content-replace${controlsLocked?' disabled':''}`}>바꾸기<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" aria-label={`${index+1}번째 사진 바꾸기`} disabled={controlsLocked} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void (async()=>{if(await edits.flush()){setEdited(true);await upload.replace(f,page.id);}})();}}/></label></>}
    </div>
    <div className="content-caption">{page.upload_status!=='ready'?<p role="status">{['reserved','validating'].includes(page.upload_status)?'업로드 확인 중…':'업로드하지 못한 사진입니다. 편집에서 삭제할 수 있어요.'}</p>:editing?<textarea aria-label={`${index+1}번째 사진 글귀`} maxLength={80} value={draft?.text??page.caption_text??''} disabled={controlsLocked} onChange={e=>{setEdited(true);edits.change(page.id,e.target.value);}} onBlur={()=>void edits.save(page.id)} placeholder="글귀를 적어주세요."/>:<p>{page.caption_text??(['failed','unknown'].includes(page.caption_status??'')?'글귀를 직접 적어주세요.':'글귀를 준비하고 있어요.')}</p>}
     {editing&&draft?.error&&<div className="content-error" role="alert"><p>{draft.error}</p>{draft.conflict?<><p>저장된 글귀: {draft.conflict.caption_text||'(빈 글귀)'}</p><button onClick={()=>edits.resolve(page.id,true)}>내 글귀로 저장</button><button onClick={()=>edits.resolve(page.id,false)}>저장된 글귀 사용</button></>:<button onClick={()=>void edits.save(page.id)}>저장 다시 시도</button>}</div>}
    </div>
    {editing&&<button className="content-handle" type="button" aria-label={`${index+1}번째 사진 순서 변경`} disabled={!allowOrder()} onClick={()=>{if(!locked)setMenu(menu===page.id?null:page.id);}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const other=pages[index+(e.key==='ArrowUp'?-1:1)];if(other)void move(page.id,other.id);}}}><svg viewBox="0 0 16 24" width="16" height="24" aria-hidden="true">{[5,12,19].flatMap(y=>[4,11].map(x=><circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" fill="currentColor"/>))}</svg><span>순서</span></button>}
    {editing&&menu===page.id&&<div className="content-move-options">{index>0&&<button disabled={controlsLocked} onClick={()=>void move(page.id,pages[index-1].id)}>앞으로 이동</button>}{index<pages.length-1&&<button disabled={controlsLocked} onClick={()=>void move(page.id,pages[index+1].id)}>뒤로 이동</button>}</div>}
   </li>;
  })}</ol>
  {order.message&&!drag.interacting&&<div className="content-toast" role="status">{order.message}</div>}
  <footer className="content-footer">{editing?<><p className="content-save-state" role="status">{captionFailed?'저장하지 못했어요.':upload.busy?'사진 저장 중…':replacement.length?'사진 교체 확인 필요':error||order.error?'변경사항을 확인해 주세요.':busy||order.busy||edits.saving||finishing?'저장 중…':edits.dirty?'변경사항 저장 대기':edited?'변경사항 저장됨':'변경사항 없음'}</p><button className="content-finish" disabled={controlsLocked} onClick={()=>void toggle()}>{finishing?'저장 중…':edited?'저장하고 완료':'완료'}</button></>:<>{order.busy?<p className="content-upload-state" role="status">순서를 저장하고 있어요.</p>:<AlbumSaveState upload={upload} pages={pages}/>}<PhotoAddButton upload={upload} remaining={Math.max(0,max-count-upload.items.filter(i=>!i.replacesPageId&&i.state!=='saved'&&(!i.pageId||!pages.some(p=>p.id===i.pageId))).length)} disabled={controlsLocked} beforeSelect={edits.flush}/><button className="content-edit" disabled={controlsLocked||!count} onClick={()=>void toggle()}>편집</button></>}</footer>
  <UploadInspector open={!!selected} photos={selected?[{id:selected.id,page:selected}]:[]} initialPhotoId={selected?.id} readOnly onClose={()=>setPreview(null)} onRemove={()=>{}} disabled media={p=>p.page?media(p.page):undefined} reload={()=>void query.refetch()} error=""/>
 </section>;
}
