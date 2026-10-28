import type {Page} from '../../api/types';
import type {TransferItem} from './easyTransport';

/** Page IDs only, scoped to the existing private tab draft. No durable upload history. */
export interface UploadBatch {id:string;photos:{itemId:string;pageId?:string}[]}
export interface UploadPhotoEntry {id:string;page?:Page;item?:TransferItem}
export interface UploadMessage {id:string;photos:UploadPhotoEntry[]}

export function photoReady(photo:UploadPhotoEntry){
 return photo.page?.upload_status==='ready'||photo.item?.state==='saved';
}
export function photoFailed(photo:UploadPhotoEntry){
 return !photoReady(photo)&&(photo.item?.state==='failed'||['rejected','expired'].includes(photo.page?.upload_status??''));
}

/** Reconcile a local acknowledgement with its server page without rendering twice. */
export function uploadMessages(pages:readonly Page[],items:readonly TransferItem[],batches:readonly UploadBatch[]){
 const pagesById=new Map(pages.map(page=>[page.id,page]));
 const submitted=items.filter(item=>item.submitted);
 const itemsById=new Map(submitted.map(item=>[item.id,item]));
 const claimed=new Set<string>();
 const messages:UploadMessage[]=[];
 const toEntry=(page:Page|undefined,item:TransferItem|undefined):UploadPhotoEntry=>({id:item?.id??page!.id,page,item});
 for(const batch of batches){
  const photos:UploadPhotoEntry[]=[];
  for(const ref of batch.photos){
   const item=itemsById.get(ref.itemId),pageId=item?.pageId??ref.pageId;
   if(pageId&&claimed.has(pageId))continue;
   const page=pageId?pagesById.get(pageId):undefined;
   if(page||item){photos.push(toEntry(page,item));if(pageId)claimed.add(pageId);}
  }
  if(photos.length)messages.push({id:batch.id,photos});
 }
 const history=pages.filter(page=>!claimed.has(page.id));
 if(history.length)messages.unshift({id:'stored-photos',photos:history.map(page=>toEntry(page,undefined))});
 return {messages,attached:items.filter(item=>!item.submitted).map(item=>toEntry(undefined,item))};
}
