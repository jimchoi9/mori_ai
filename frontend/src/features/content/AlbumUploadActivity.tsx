import {useEffect,useRef,useState} from 'react';
import type {Page} from '../../api/types';
import type {useEasyUploads} from '../uploads/useEasyUploads';
import {UploadPhoto} from '../uploads/UploadPhoto';
type Uploads=ReturnType<typeof useEasyUploads>;
function saveState(upload:Uploads,pages:Page[]){
 const confirmed=new Set(upload.items.filter(item=>item.state==='saved'&&item.pageId).map(item=>item.pageId!));
 const known=new Set(pages.map(page=>page.id));
 const saved=pages.filter(page=>page.upload_status==='ready'||confirmed.has(page.id)).length+
  upload.items.filter(item=>!item.replacesPageId&&item.state==='saved'&&item.pageId&&!known.has(item.pageId)).length;
 const pending=upload.items.filter(item=>item.state!=='saved').length;
 const checking=pages.some(page=>page.upload_status!=='ready'&&!confirmed.has(page.id));
 return {saved,needsAttention:pending>0||checking||!!upload.error,captionPending:pages.some(page=>page.upload_status==='ready'&&page.caption_text===null&&['waiting','queued','running'].includes(page.caption_status??''))};
}
export function AlbumSaveState({upload,pages}:{upload:Uploads;pages:Page[]}){
 const state=saveState(upload,pages);
 const text=upload.busy?'사진을 저장하고 있어요.':state.needsAttention?`사진 ${state.saved}장 저장 · 확인 필요`:state.saved?`사진 ${state.saved}장 저장 완료`:'';
 return text?<p className="content-upload-state" role="status">{text}{!upload.busy&&!state.needsAttention&&state.captionPending&&<span> · 글귀 준비 중</span>}</p>:null;
}
export function PhotoAddButton({upload,remaining,disabled,beforeSelect}:{upload:Uploads;remaining:number;disabled:boolean;beforeSelect:()=>Promise<boolean>}){
 return <label className={`content-add${disabled||remaining<=0?' disabled':''}`}>＋ 사진 추가<input type="file" aria-label="사진 추가" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" disabled={disabled||remaining<=0} onChange={e=>{
  const files=Array.from(e.target.files??[]);e.target.value='';if(!files.length)return;
  void (async()=>{if(!await beforeSelect())return;const selected=upload.select(files,remaining);if(selected.length&&files.length<=remaining)await upload.send(selected.map(item=>item.id));})();
 }}/></label>;
}
export function AlbumUploadActivity({upload,pages,max,canLeave=true}:{upload:Uploads;pages:Page[];max:number;canLeave?:boolean}){
 const [notice,setNotice]=useState<{title:string;detail:string}|null>(null),active=useRef<string[]>([]);
 const items=upload.items.filter(item=>!item.replacesPageId),pending=items.filter(item=>item.state!=='saved');
 const pageIds=new Set(pages.map(p=>p.id)),count=pages.length+pending.filter(item=>!item.pageId||!pageIds.has(item.pageId)).length,over=Math.max(0,count-max);
 useEffect(()=>{
  if(upload.busy){active.current=upload.activeIds.filter(id=>items.some(item=>item.id===id));setNotice(null);return;}
  if(active.current.length){
   const saved=items.filter(item=>active.current.includes(item.id)&&item.state==='saved').length;
   if(saved){const state=saveState(upload,pages);setNotice(state.needsAttention?
    {title:`사진 ${saved}장 저장 · 확인 필요`,detail:'저장하지 못한 사진을 확인해 주세요.'}:
    {title:`사진 ${saved}장을 저장했어요.`,detail:state.captionPending?'이제 나가도 괜찮아요. 글귀는 계속 준비해요.':'이제 화면을 나가도 괜찮아요.'});}
   active.current=[];
  }
 },[upload.busy,upload.activeIds]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),6000);return()=>clearTimeout(timer);},[notice]);
 const inFlight=items.filter(item=>upload.activeIds.includes(item.id)),done=inFlight.filter(item=>item.state==='saved').length;
 return <>
  {notice&&canLeave&&<div className="content-toast" role="status"><strong>{notice.title}</strong><span>{notice.detail}</span></div>}
  {upload.busy&&inFlight.length>0&&<div className="content-upload-progress" role="status">업로드 중 {done}/{inFlight.length}<progress max={inFlight.length} value={done}/></div>}
  {!upload.busy&&pending.length>0&&<section className="content-upload-pending" aria-label="업로드 확인 필요">
   <p role="alert">{over?`${max}장까지 추가할 수 있어요. ${over}장을 빼주세요.`:upload.error||'업로드하지 못한 사진을 확인해 주세요.'}</p>
   <ul>{pending.map((item,index)=><li key={item.id}><UploadPhoto photo={{id:item.id,item}} label={`${index+1}번째 대기 사진`} reload={()=>{}} onRemove={()=>void upload.remove(item)}/>{item.error&&<p>{item.error}</p>}</li>)}</ul>
   <button disabled={over>0} onClick={()=>void upload.send(pending.map(item=>item.id))}>{pending.some(item=>item.submitted)?'업로드 다시 시도':`${pending.length}장 업로드`}</button>
  </section>}
 </>;
}
