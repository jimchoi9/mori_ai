import {useEffect,useRef,useState} from 'react';
import type {Page} from '../../api/types';
import type {useEasyUploads} from '../uploads/useEasyUploads';
import {UploadPhoto} from '../uploads/UploadPhoto';
type Uploads=ReturnType<typeof useEasyUploads>;
export function PhotoAddButton({upload,remaining,disabled,beforeSelect}:{upload:Uploads;remaining:number;disabled:boolean;beforeSelect:()=>Promise<boolean>}){
 return <label className={`content-add${disabled||remaining<=0?' disabled':''}`}>＋ 사진 추가<input type="file" aria-label="사진 추가" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" disabled={disabled||remaining<=0} onChange={e=>{
  const files=Array.from(e.target.files??[]);e.target.value='';if(!files.length)return;
  void (async()=>{if(!await beforeSelect())return;const selected=upload.select(files,remaining);if(selected.length&&files.length<=remaining)await upload.send(selected.map(item=>item.id));})();
 }}/></label>;
}
export function AlbumUploadActivity({upload,pages,max}:{upload:Uploads;pages:Page[];max:number}){
 const [notice,setNotice]=useState(''),active=useRef<string[]>([]);
 const items=upload.items.filter(item=>!item.replacesPageId),pending=items.filter(item=>item.state!=='saved');
 const pageIds=new Set(pages.map(p=>p.id)),count=pages.length+pending.filter(item=>!item.pageId||!pageIds.has(item.pageId)).length,over=Math.max(0,count-max);
 useEffect(()=>{
  if(upload.busy){active.current=upload.activeIds.filter(id=>items.some(item=>item.id===id));setNotice('');return;}
  if(active.current.length){const saved=items.filter(item=>active.current.includes(item.id)&&item.state==='saved').length;if(saved)setNotice(`${saved}장 업로드 완료`);active.current=[];}
 },[upload.busy,upload.activeIds]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2800);return()=>clearTimeout(timer);},[notice]);
 const inFlight=items.filter(item=>upload.activeIds.includes(item.id)),done=inFlight.filter(item=>item.state==='saved').length;
 return <>
  {notice&&<div className="content-toast" role="status">{notice}</div>}
  {upload.busy&&inFlight.length>0&&<div className="content-upload-progress" role="status">업로드 중 {done}/{inFlight.length}<progress max={inFlight.length} value={done}/></div>}
  {!upload.busy&&pending.length>0&&<section className="content-upload-pending" aria-label="업로드 확인 필요">
   <p role="alert">{over?`${max}장까지 추가할 수 있어요. ${over}장을 빼주세요.`:upload.error||'업로드하지 못한 사진을 확인해 주세요.'}</p>
   <ul>{pending.map((item,index)=><li key={item.id}><UploadPhoto photo={{id:item.id,item}} label={`${index+1}번째 대기 사진`} reload={()=>{}} onRemove={()=>void upload.remove(item)}/>{item.error&&<p>{item.error}</p>}</li>)}</ul>
   <button disabled={over>0} onClick={()=>void upload.send(pending.map(item=>item.id))}>{pending.some(item=>item.submitted)?'업로드 다시 시도':`${pending.length}장 업로드`}</button>
  </section>}
 </>;
}
