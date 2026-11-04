import {api} from '../../api/client';
import type {MediaAccess,Viewer} from '../../api/types';
import type {MemorySource} from './source';
/** Owner login and signed media only. Never creates or exposes a physical tag secret. */
export function ownerSource(albumId:string):MemorySource{
 let urls=new Map<string,MediaAccess>(),allowed=new Set<string>(),renewal:Promise<void>|null=null;
 const renew=async(signal:AbortSignal)=>{
  if(!renewal)renewal=api<{media_access:MediaAccess[]}>(`/albums/${albumId}/media-access`,{method:'POST',body:{asset_ids:[...allowed]},signal}).then(data=>{signal.throwIfAborted();urls=new Map(data.media_access.map(a=>[a.asset_id,a]));}).finally(()=>{renewal=null;});
  return renewal;
 };
 return {available:true,private:true,missing:'내 앨범에서 다시 열어 주세요.',
  async open(signal){
   const data=await api<Viewer>(`/albums/${albumId}/viewer`,{signal});
   allowed=new Set(data.pages.flatMap(p=>[p.image.asset_id,...(p.thumbnail?[p.thumbnail.asset_id]:[])]));
   urls=new Map(data.media_access.map(a=>[a.asset_id,a]));await renew(signal);
   return {state:'ready',album_title:data.title,pages:data.pages.map(p=>({id:p.id,text:p.caption_text,src:p.image.asset_id,...(p.thumbnail?{thumb:p.thumbnail.asset_id}:{})})),music_url:data.music?.url??null};
  },
  async read(path,signal){
   if(path==='/audio/bgm.mp3'){const r=await fetch(path,{credentials:'same-origin',cache:'no-store',signal});if(!r.ok)throw Error('배경음악을 불러오지 못했어요.');return r.blob();}
   if(!allowed.has(path))throw Error('감상 자료를 확인하지 못했어요.');
   for(let attempt=0;attempt<2;attempt++){
    const access=urls.get(path);if(!access||Date.parse(access.expires_at)<Date.now()+1000)await renew(signal);
    const current=urls.get(path);if(!current)throw Error('사진을 불러오지 못했어요.');
    const url=new URL(current.url,location.origin);if(!['http:','https:'].includes(url.protocol))throw Error('사진 주소를 확인하지 못했어요.');
    const response=await fetch(url,{credentials:url.origin===location.origin?'same-origin':'omit',cache:'no-store',signal});
    if(response.ok)return response.blob();
    if(attempt===0&&[401,403].includes(response.status)){await renew(signal);continue;}
    throw Error('사진을 불러오지 못했어요. 다시 불러와 주세요.');
   }
   throw Error('사진을 불러오지 못했어요.');
  },close(){urls.clear();allowed.clear();}};
}
