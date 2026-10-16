import { useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText, uploadHeaders } from '../../api/client';
import type { Detail, Reservation, UploadView } from '../../api/types';
interface Intent { key:string; files:{file:File;id:string}[]; body:unknown; reservation?:Reservation; put:Set<string>; complete:Set<string> }
const drafts = new Map<string,{files:File[];intent:Intent|null}>();
window.addEventListener('mori:logout',()=>drafts.clear());
export function useUploads(albumId:string, userId:string, refresh:()=>Promise<unknown>) {
 const draftKey=`${userId}:${albumId}`;
 const intent = useRef<Intent|null>(drafts.get(draftKey)?.intent ?? null); const controller = useRef<AbortController|null>(null);
 const [files,setFiles] = useState<File[]>(drafts.get(draftKey)?.files ?? []); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [progress,setProgress] = useState('');
 const latestFiles=useRef(files); latestFiles.current=files;
 useEffect(()=>{
  let discard=false;
  const clear=()=>{discard=true;drafts.clear();intent.current=null;controller.current?.abort();};
  window.addEventListener('mori:logout',clear);
  return()=>{controller.current?.abort();if(!discard)drafts.set(draftKey,{files:latestFiles.current,intent:intent.current});window.removeEventListener('mori:logout',clear);};
 },[draftKey]);
 async function send() {
  if(busy || !files.length)return;
  setBusy(true); setError(''); const abort = new AbortController(); controller.current=abort;
  try {
   if (!intent.current) {
    const selected=files.map(file=>({file,id:crypto.randomUUID()}));
    const latest=await api<Detail>(`/albums/${albumId}`,{signal:abort.signal});
    intent.current={key:crypto.randomUUID(),files:selected,body:{expected_version:latest.detail.album.version,files:selected.map(({file,id})=>({client_file_id:id,filename:file.name,mime:file.type,bytes:file.size,file_last_modified_at:new Date(file.lastModified).toISOString()}))},put:new Set(),complete:new Set()};
   }
   const current=intent.current;
   setProgress('업로드 공간 예약 중');
   current.reservation ??= await api<Reservation>(`/albums/${albumId}/uploads`,{method:'POST',body:current.body,key:current.key,signal:abort.signal});
   for (const upload of current.reservation.uploads) {
    const file=current.files.find(f=>f.id===upload.client_file_id)!.file;
    setProgress(`${file.name} · 업로드 중`);
    if (!current.put.has(upload.upload_id)) {
     const state=await api<UploadView>(`/albums/${albumId}/uploads/${upload.upload_id}`,{signal:abort.signal});
     if(state.status==='reserved') {
      const response=await fetch(upload.upload_url,{method:upload.method,headers:uploadHeaders(upload.upload_url,upload.required_headers),body:file,credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(120000)])});
      if(!response.ok)throw new Error(`파일 전송 실패 (${response.status}). 같은 요청으로 다시 시도해 주세요.`);
     }
     current.put.add(upload.upload_id);
    }
    if(!current.complete.has(upload.upload_id)) {
     await api<UploadView>(`/albums/${albumId}/uploads/${upload.upload_id}/complete`,{method:'POST',body:{},signal:abort.signal});
     current.complete.add(upload.upload_id);
    }
   }
   await refresh(); intent.current=null; setFiles([]); setProgress('전송 완료 · 서버에서 사진을 검증하고 정규화합니다.');
  }catch(e){if(!abort.signal.aborted){if(e instanceof ApiError && e.status!==401 && e.status<500 && !intent.current?.reservation)intent.current=null;setError(errorText(e)); await refresh().catch(()=>undefined);}}finally{if(!abort.signal.aborted)setBusy(false);}
 }
 function select(next:File[]) { if(intent.current || busy)return; setFiles(next); setError(''); setProgress(''); }
 function discard() { intent.current=null; setFiles([]); setError(''); setProgress(''); }
 return {files,select,send,busy,error,progress,locked:intent.current!==null,discard};
}
