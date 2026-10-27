import {api,ApiError,uploadHeaders} from '../../api/client';
import type {Detail,Reservation,UploadView} from '../../api/types';
import {completionBody,uploadStep} from './putFile';
import type {SendItem} from './easyQueue';

export interface TransferItem extends SendItem {
 intent?:{key:string;body:unknown;reservation?:Reservation;put:Set<string>;complete:Set<string>;sha256:string;thumbnail_sha256?:string};
}
export const wait=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
});
const retryable=(error:unknown)=>error instanceof TypeError||error instanceof DOMException&&error.name==='TimeoutError'||error instanceof ApiError&&(error.retryable||[408,429,500,502,503,504].includes(error.status));
export async function retry<T>(operation:()=>Promise<T>,signal:AbortSignal,pause=wait):Promise<T>{
 for(let attempt=0;;attempt++){
  signal.throwIfAborted();
  try{return await operation();}catch(error){signal.throwIfAborted();if(attempt>=2||!retryable(error))throw error;await pause(350*2**attempt,signal);}
 }
}

export async function transferPhoto(albumId:string,item:TransferItem,signal:AbortSignal,changed:()=>void,rebase=0):Promise<void>{
 const prepared=item.prepared!;
 if(!item.intent){
  const sha256=(await completionBody(prepared.file,{'If-None-Match':'*'})).sha256!;
  const thumbnail_sha256=prepared.thumbnail?(await completionBody(prepared.thumbnail,{'If-None-Match':'*'})).sha256:undefined;
  const detail=await retry(()=>api<Detail>(`/albums/${albumId}`,{signal}),signal);
  item.intent={key:crypto.randomUUID(),put:new Set(),complete:new Set(),sha256,thumbnail_sha256,
   body:{expected_version:detail.detail.album.version,files:[{client_file_id:item.id,filename:prepared.file.name,mime:'image/webp',bytes:prepared.file.size,file_last_modified_at:new Date(prepared.file.lastModified).toISOString(),preprocessing:prepared.preprocessing,
    ...(prepared.thumbnail?{thumbnail:{bytes:prepared.thumbnail.size,mime:'image/webp',sha256:thumbnail_sha256}}:{})}]}};
 }
 const intent=item.intent;
 if(!intent.reservation){
  try{intent.reservation=await retry(()=>api<Reservation>(`/albums/${albumId}/uploads`,{method:'POST',body:intent.body,key:intent.key,signal}),signal);}
  catch(error){
   // An explicit version refusal proves no acceptance for this key; lost replies
   // instead replay the exact immutable body/key above.
   if(error instanceof ApiError&&error.code==='VERSION_CONFLICT'&&rebase<2){item.intent=undefined;return transferPhoto(albumId,item,signal,changed,rebase+1);}
   throw error;
  }
 }
 const upload=intent.reservation.uploads[0];item.pageId=upload.page_id;changed();
 await retry(()=>uploadStep(upload,prepared.file,intent,signal,uploadHeaders(upload.upload_url,upload.required_headers),
  ()=>api<UploadView>(`/albums/${albumId}/uploads/${upload.upload_id}`,{signal}),
  body=>api<UploadView>(`/albums/${albumId}/uploads/${upload.upload_id}/complete`,{method:'POST',body,signal}),
  prepared.thumbnail?{file:prepared.thumbnail,sha256:intent.sha256,thumbnail_sha256:intent.thumbnail_sha256!,headers:uploadHeaders(upload.thumbnail_upload!.url,upload.thumbnail_upload!.required_headers)}:undefined),signal);
 item.transferred=true;item.state='checking';changed();
}

export async function verifyPhoto(albumId:string,item:TransferItem,signal:AbortSignal){
 const upload=item.intent!.reservation!.uploads[0];
 const deadline=Date.now()+180000;
 for(;;){
  const state=await retry(()=>api<UploadView>(`/albums/${albumId}/uploads/${upload.upload_id}`,{signal}),signal);
  if(state.status==='ready')return;
  if(state.status==='rejected'||state.status==='expired')throw new Error('이 사진의 저장을 확인하지 못했어요. 선택한 사진은 남겨 두었어요.');
  if(Date.now()>deadline)throw new Error('사진은 전송됐어요. 저장 확인이 늦어져 연결이 돌아오면 다시 확인할게요.');
  await wait(1000,signal);
 }
}
