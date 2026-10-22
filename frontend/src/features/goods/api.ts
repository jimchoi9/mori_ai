import {api,uploadHeaders,ApiError} from '../../api/client';
import type {Placement} from './mockup/preview';
import type {AlbumStatus} from '../../api/types';
export interface GoodsRevision {id:string;request_key:string;parent_id:string|null;message:string;style:string;status:'queued'|'running'|'ready'|'failed'|'unknown'|'cancelled';image_url:string|null;error_code:string|null;fake:boolean}
export interface TestPurchase {id:string;mode:'test';status:'simulated';album_id:string;album_status:AlbumStatus}
export interface GoodsDesign {id:string;fake:boolean;image_url:string;placement:Placement;album_id:string|null;version:number;production_started:boolean;created_at:string;test_purchase?:TestPurchase|null}
const sourceMessages:Record<string,string>={
 IMAGE_SIZE_LIMIT_EXCEEDED:'사진 용량이 너무 큽니다. 20MiB 이하 사진을 선택해 주세요.',
 IMAGE_PIXEL_LIMIT_EXCEEDED:'사진 해상도가 너무 큽니다. 4,000만 화소 이하로 줄인 사진을 선택해 주세요.',
 UNSUPPORTED_MEDIA:'지원하지 않는 사진 형식입니다. JPG·PNG·WebP·HEIC/HEIF 사진을 선택해 주세요.',
 IMAGE_DECODE_FAILED:'사진을 읽을 수 없습니다. 손상되지 않은 다른 사진을 선택해 주세요.',
 IMAGE_NORMALIZATION_FAILED:'사진의 색상이나 형식을 변환하지 못했어요. SDR JPG·PNG 사진으로 저장한 뒤 다시 시도해 주세요.',
 IMAGE_PROCESS_MEMORY_LIMIT:'사진을 처리할 메모리가 부족합니다. 사진 크기를 줄인 뒤 다시 시도해 주세요.',
 IMAGE_PROCESS_TIMEOUT:'사진 처리 시간이 초과됐어요. 사진 크기를 줄이거나 잠시 후 다시 시도해 주세요.',
 IMAGE_PROCESS_BUSY:'다른 사진을 처리하고 있어요. 잠시 후 다시 시도해 주세요.',
};
async function sourceResponse(response:Response){
 if(response.ok)return;
 const payload=await response.json().catch(()=>null);
 const code=payload?.error?.code??'HTTP_ERROR';
 if(response.status===401)window.dispatchEvent(new Event('mori:unauthorized'));
 const statuses:Record<number,string>={401:'로그인이 만료되었습니다. 다시 로그인해 주세요.',403:'사진 처리 동의 또는 접근 권한을 확인해 주세요.',404:'사진 작업을 찾을 수 없거나 만료되었습니다.',413:sourceMessages.IMAGE_SIZE_LIMIT_EXCEEDED,415:sourceMessages.UNSUPPORTED_MEDIA,422:'사진을 확인하지 못했어요. 다른 사진으로 다시 시도해 주세요.'};
 throw new ApiError(response.status,code,statuses[response.status===401||response.status===403?response.status:0]??sourceMessages[code]??statuses[response.status]??'서버에서 사진을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',payload?.error?.details??{},payload?.error?.retryable??false,payload?.request_id);
}
const requestSignal=(signal?:AbortSignal)=>signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
export async function uploadSource(work:string,file:File,signal?:AbortSignal){
 const url=`/api/v1/goods/work/${work}/source`;
 const response=await fetch(url,{method:'PUT',body:file,credentials:'same-origin',headers:uploadHeaders(url,{'Content-Type':file.type||'application/octet-stream'}),signal:requestSignal(signal)});
 await sourceResponse(response);
}
// Fetch the owner-only normalized source, then decode before replacing existing work.
export async function loadSourcePreview(work:string,signal:AbortSignal):Promise<string>{
 const response=await fetch(`/api/v1/goods/work/${work}/source`,{credentials:'same-origin',cache:'no-store',signal:requestSignal(signal)});
 await sourceResponse(response);
 const blob=await response.blob();signal.throwIfAborted();
 const url=URL.createObjectURL(blob);
 try{
  await new Promise<void>((resolve,reject)=>{
   const img=new Image();
   const cleanup=()=>{img.onload=null;img.onerror=null;signal.removeEventListener('abort',abort);};
   const abort=()=>{cleanup();img.src='';reject(signal.reason);};
   img.onload=()=>{cleanup();resolve();};
   img.onerror=()=>{cleanup();reject(Error('사진 미리보기를 읽지 못했어요. 다시 시도해 주세요.'));};
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted){abort();return;}
   img.src=url;
  });
  signal.throwIfAborted();return url;
 }catch(error){URL.revokeObjectURL(url);throw error;}
}
export function abandon(work:string,keepalive=false){
 const url=`/api/v1/goods/work/${work}`;
 return fetch(url,{method:'DELETE',credentials:'same-origin',headers:uploadHeaders(url,{}),keepalive}).catch(()=>undefined);
}
export const goodsApi=api;
