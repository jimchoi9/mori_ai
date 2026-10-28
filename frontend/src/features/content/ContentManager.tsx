import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {Config,Detail,Page} from '../../api/types';
import {albumPath} from '../generation/flow';
import {UploadPhoto} from '../uploads/UploadPhoto';
import {UploadInspector} from '../uploads/UploadInspector';
import {useEasyUploads,hasUploadDraft} from '../uploads/useEasyUploads';
import {useCaptionEdits} from './useCaptionEdits';
import {usePhotoReorder} from './usePhotoReorder';
import '../uploads/easyUpload.css';
import './content.css';
const noPages:Page[]=[];
export function ContentManager({userId}:{userId:string}){
 const {albumId=''}=useParams(),navigate=useNavigate(),cache=useQueryClient();
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 const query=useQuery({queryKey:['album',userId,albumId],enabled:!!config.data,retry:false,
  queryFn:async({signal})=>{const d=await api<Detail>(`/albums/${albumId}`,{signal});return !d.detail.album.content_enabled&&config.data?.album_content_enabled?api<Detail>(`/albums/${albumId}/content`,{method:'POST',body:{},signal}):d;},
  refetchInterval:q=>!document.hidden&&q.state.data?.detail.pages.some(p=>['reserved','validating'].includes(p.upload_status)||p.caption_text===null&&['waiting','queued','running'].includes(p.caption_status??''))?1800:false});
 const pages=query.data?.detail.pages??noPages,album=query.data?.detail.album;
 const refresh=async()=>{await query.refetch();await cache.invalidateQueries({queryKey:['albums',userId]});};
 const upload=useEasyUploads(albumId,userId,refresh,config.data?.easy_upload?.max_photos??20,pages.map(p=>p.id));
 const edits=useCaptionEdits(albumId,pages,refresh);
 const [editing,setEditing]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<string|null>(null),[menu,setMenu]=useState<string|null>(null);
 const list=useRef<HTMLOListElement>(null),replacement=upload.items.filter(i=>i.replacesPageId&&i.state!=='saved');
 const locked=busy||upload.busy;
 const media=(page:Page)=>query.data?.media_access.find(a=>a.asset_id===(page.thumbnail??page.source)?.asset_id);
 useEffect(()=>{if(album&&!album.content_enabled&&!config.data?.album_content_enabled)navigate(albumPath(album),{replace:true});},[album?.content_enabled,config.data?.album_content_enabled]);
 useEffect(()=>{if(album?.content_enabled&&!pages.length&&!hasUploadDraft(userId,albumId))navigate(`/albums/${albumId}/edit`,{replace:true});},[album?.content_enabled,pages.length]);
 useEffect(()=>{if(album&&hasUploadDraft(userId,albumId))navigate(`/albums/${albumId}/edit`,{replace:true});},[albumId,userId,!!album]);
 async function mutate(operation:(fresh:Detail)=>Promise<unknown>){if(locked)return;setBusy(true);setError('');try{if(!await edits.flush())return;const fresh=await api<Detail>(`/albums/${albumId}`);await operation(fresh);await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function move(from:string,to:string){if(from===to)return;await mutate(async fresh=>{const ids=fresh.detail.pages.map(p=>p.id),a=ids.indexOf(from),b=ids.indexOf(to);if(a<0||b<0)return;ids.splice(a,1);ids.splice(b,0,from);await api(`/albums/${albumId}/page-order`,{method:'PUT',body:{expected_version:fresh.detail.album.version,page_ids:ids}});});}
 const drag=usePhotoReorder(list,(a,b)=>{void move(a,b);});
 async function toggle(){if(editing){if(!await edits.flush())return;drag.stop();setMenu(null);}setEditing(!editing);}
 const selected=pages.find(p=>p.id===preview);
 const count=pages.length,max=config.data?.easy_upload?.max_photos??20;
 if(config.isError||query.isError)return <section><p role="alert">{errorText(config.error??query.error)}</p><button onClick={()=>void query.refetch()}>다시 불러오기</button></section>;
 if(!album)return <p role="status">사진·글귀를 불러오는 중…</p>;
 return <section className="content-manager">
  <header className="easy-upload-heading"><Link className="easy-upload-back" to="/albums" aria-label="내 사진첩으로">‹</Link><h1>{album.title}</h1><span>최대 {max}장</span></header>
  <div className="content-toolbar"><span>사진·글귀 {count}장</span>{count<max&&<button type="button" disabled={locked} onClick={async()=>{if(await edits.flush())navigate(`/albums/${albumId}/edit`);}}>＋ 사진</button>}{count>0&&<button type="button" disabled={locked} onClick={()=>void toggle()}>{editing?'편집 마치기':'편집'}</button>}</div>
  {editing&&<p className="content-hint">글귀를 눌러 수정 · 손잡이를 끌어 순서 변경</p>}
  {(error||upload.error)&&<p role="alert">{error||upload.error}</p>}
  {replacement.map(item=><div key={item.id} className="content-replacement" role="status">{upload.busy?'사진을 바꾸고 있어요.':<>{item.error??'사진 교체를 확인해주세요.'}<button onClick={()=>void upload.send([item.id])}>다시 시도</button><button onClick={()=>void upload.remove(item)}>취소</button></>}</div>)}
  {!count&&<p className="content-hint">사진을 골라 보내주세요.</p>}
  <ol ref={list} className="content-pages">{pages.map((page,index)=>{
   const draft=edits.drafts[page.id],photo={id:page.id,page};
   return <li key={page.id} data-page={page.id} className={drag.target===page.id?'content-target':''}>
    <div className="content-photo"><UploadPhoto photo={photo} access={media(page)} label={`${index+1}번째 사진 확인`} reload={()=>void query.refetch()} onOpen={!editing?()=>setPreview(page.id):undefined}/><span className="content-number">{index+1}</span>
     {editing&&<><button className="content-remove" aria-label={`${index+1}번째 사진 삭제`} disabled={locked} onClick={()=>{if(window.confirm('이 사진을 앨범에서 삭제할까요?'))void mutate(fresh=>api(`/albums/${albumId}/pages/${page.id}?expected_version=${fresh.detail.album.version}`,{method:'DELETE'}));}}>−</button>
      <label className={`content-replace${locked?' disabled':''}`}>바꾸기<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" aria-label={`${index+1}번째 사진 바꾸기`} disabled={locked} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void (async()=>{if(await edits.flush())await upload.replace(f,page.id);})();}}/></label></>}
    </div>
    <div className="content-caption">{editing?<textarea aria-label={`${index+1}번째 사진 글귀`} maxLength={80} value={draft?.text??page.caption_text??''} disabled={locked} onChange={e=>edits.change(page.id,e.target.value)} onBlur={()=>void edits.save(page.id)} placeholder="글귀를 적어주세요."/>:<p>{page.caption_text??(['failed','unknown'].includes(page.caption_status??'')?'글귀를 직접 적어주세요.':'글귀를 준비하고 있어요.')}</p>}
     {editing&&draft?.error&&<div className="content-error" role="alert"><p>{draft.error}</p>{draft.conflict?<><p>저장된 글귀: {draft.conflict.caption_text||'(빈 글귀)'}</p><button onClick={()=>edits.resolve(page.id,true)}>내 글귀로 저장</button><button onClick={()=>edits.resolve(page.id,false)}>저장된 글귀 사용</button></>:<button onClick={()=>void edits.save(page.id)}>저장 다시 시도</button>}</div>}
    </div>
    {editing&&<button className="content-handle" type="button" aria-label={`${index+1}번째 사진 순서 변경`} disabled={locked} onPointerDown={e=>drag.down(page.id,e)} onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.stop} onClick={()=>{if(!drag.suppressClick())setMenu(menu===page.id?null:page.id);}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const other=pages[index+(e.key==='ArrowUp'?-1:1)];if(other)void move(page.id,other.id);}}}>⠿</button>}
    {editing&&menu===page.id&&<div className="content-move-options">{index>0&&<button disabled={locked} onClick={()=>void move(page.id,pages[index-1].id)}>앞으로 이동</button>}{index<pages.length-1&&<button disabled={locked} onClick={()=>void move(page.id,pages[index+1].id)}>뒤로 이동</button>}</div>}
   </li>;
  })}</ol>
  {editing&&<p className="content-save-state" role="status">{edits.saving?'저장 중…':edits.dirty?'변경한 글귀를 저장하고 있어요.':'저장됨'}</p>}
  <UploadInspector open={!!selected} photos={selected?[{id:selected.id,page:selected}]:[]} initialPhotoId={selected?.id} readOnly onClose={()=>setPreview(null)} onRemove={()=>{}} disabled media={p=>p.page?media(p.page):undefined} reload={()=>void query.refetch()} error=""/>
 </section>;
}
