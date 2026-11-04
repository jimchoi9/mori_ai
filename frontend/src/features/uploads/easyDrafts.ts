import type {TransferItem} from './easyTransport';
import type {UploadBatch} from './uploadMessages';

export interface Draft {notifications:Set<AbortController>;items:TransferItem[];batches:UploadBatch[];activeIds:string[];busy:boolean;controller?:AbortController;listeners:Set<()=>void>;startIds?:string[]}
export const drafts=new Map<string,Draft>();
/** Handoff after explicit native selection; no File is placed in navigation state. */
export function stageNewAlbumUploads(userId:string,albumId:string,files:File[]){
 const key=`${userId}:${albumId}`;
 if(drafts.get(key)?.items.length)throw new Error('이미 고른 사진이 있어요. 앨범에서 확인해 주세요.');
 const items:TransferItem[]=files.map(file=>({id:crypto.randomUUID(),file,state:'selected'}));
 drafts.set(key,{notifications:new Set(),items,batches:[],activeIds:[],busy:false,listeners:new Set(),startIds:items.map(item=>item.id)});
}
export function hasUploadDraft(userId:string,albumId:string){return drafts.get(`${userId}:${albumId}`)?.items.some(item=>!item.replacesPageId&&item.state!=='saved')??false;}
/** Only a confirmed album deletion may discard this album's retry files. */
export function discardAlbumUploads(userId:string,albumId:string){
 const key=`${userId}:${albumId}`,draft=drafts.get(key);if(!draft)return;
 draft.controller?.abort();for(const notification of draft.notifications)notification.abort();draft.notifications.clear();
 draft.items=[];draft.batches=[];draft.activeIds=[];draft.startIds=undefined;draft.busy=false;draft.listeners.forEach(listener=>listener());drafts.delete(key);
}
function clearDrafts(){for(const draft of drafts.values()){draft.controller?.abort();for(const request of draft.notifications)request.abort();draft.notifications.clear();draft.items=[];draft.batches=[];draft.activeIds=[];draft.startIds=undefined;draft.busy=false;draft.listeners.forEach(f=>f());}drafts.clear();}
if(typeof window!=='undefined'){window.addEventListener('mori:logout',clearDrafts);window.addEventListener('mori:clear-private-memory',clearDrafts);}

