import type {Entry} from './entry';
export interface NfcBook {state:'ready';session_token:string;expires_at:string;album_title:string;pages:{id:string;text:string;src:string;thumb?:string}[];music_url:string|null}
export class NfcSessionExpired extends Error{}
export async function enter(entry:Entry,signal:AbortSignal):Promise<NfcBook|{state:'preparing'}> {
 const response=await fetch(`/api/v1/nfc/tags/${entry.id}/enter`,{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:entry.key}),signal});
 if(!response.ok)throw new Error(response.status===404?'이 추억책을 지금 열 수 없어요.':'추억책을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.');
 return (await response.json()).data;
}
export async function download(path:string,token:string,signal:AbortSignal):Promise<Blob> {
 if(!/^\/api\/v1\/nfc\/(?:media\/[0-9a-f-]{36}|music)$/.test(path))throw new Error('감상 자료 주소를 확인하지 못했어요.');
 const response=await fetch(path,{credentials:'omit',cache:'no-store',headers:{'X-Mori-Viewer-Token':token},signal});
 if(!response.ok){if(response.status===401)throw new NfcSessionExpired('사진첩을 다시 불러와 주세요.');throw new Error('추억을 모두 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');}
 return response.blob();
}
export function close(token:string) {
 return fetch('/api/v1/nfc/close',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),keepalive:true}).catch(()=>undefined);
}
let library:Promise<void>|undefined;
export function readerLibrary() {
 return library??=Promise.all(['page-flip.js','book.js'].map(name=>new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src=`/nfc-assets/${name}`;
  script.onload=()=>resolve();script.onerror=()=>{script.remove();library=undefined;reject(new Error('책을 불러오지 못했어요. 다시 시도해 주세요.'));};document.head.append(script);
 }))).then(()=>undefined);
}
