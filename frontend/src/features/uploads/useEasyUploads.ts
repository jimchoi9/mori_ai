import {useEffect,useRef,useState} from 'react';
import {api,errorText} from '../../api/client';
import type {Detail} from '../../api/types';
import {sendPhotos} from './easyQueue';
import {optimizePhoto} from './optimizePhoto';
import {transferPhoto,verifyPhoto,type TransferItem} from './easyTransport';

interface Draft {items:TransferItem[];busy:boolean;controller?:AbortController;listeners:Set<()=>void>}
const drafts=new Map<string,Draft>();
function clearDrafts(){for(const draft of drafts.values()){draft.controller?.abort();draft.items=[];draft.busy=false;draft.listeners.forEach(f=>f());}drafts.clear();}
window.addEventListener('mori:logout',clearDrafts);window.addEventListener('mori:clear-private-memory',clearDrafts);

export function useEasyUploads(albumId:string,userId:string,refresh:()=>Promise<unknown>,maxPhotos:20|50,knownPageIds:readonly string[]=[]){
 const key=`${userId}:${albumId}`;
 if(!drafts.has(key))drafts.set(key,{items:[],busy:false,listeners:new Set()});
 const draft=drafts.get(key)!,[,render]=useState(0),[error,setError]=useState('');
 const refreshRef=useRef(refresh);refreshRef.current=refresh;
 const knownIds=useRef(new Set(knownPageIds));knownIds.current=new Set(knownPageIds);
 const changed=()=>draft.listeners.forEach(f=>f());
 async function send(){
  if(draft.busy||!draft.items.some(item=>item.state!=='saved'))return;
  draft.busy=true;setError('');const controller=new AbortController();draft.controller=controller;changed();
  try{
   const fresh=await api<Detail>(`/albums/${albumId}`,{signal:controller.signal});
   const ids=new Set(fresh.detail.pages.map(page=>page.id));
   const staged=draft.items.filter(item=>item.state!=='saved'&&(!item.pageId||!ids.has(item.pageId)));
   if(fresh.detail.pages.length+staged.length>maxPhotos)throw new Error(`${maxPhotos}장까지 담을 수 있어요. 초과한 사진만 선택 해제해 주세요.`);
   await sendPhotos(draft.items,controller.signal,{prepare:(item,signal)=>optimizePhoto(item.file,signal),
    transfer:(item,signal)=>transferPhoto(albumId,item,signal,changed),
    verify:async(item,signal)=>{await verifyPhoto(albumId,item,signal);await refreshRef.current();},changed});
  }catch(e){if(!controller.signal.aborted)setError(errorText(e));}
  finally{if(draft.controller===controller){draft.busy=false;draft.controller=undefined;}changed();void refreshRef.current().catch(()=>undefined);}
 }
 useEffect(()=>{
  const update=()=>render(n=>n+1);draft.listeners.add(update);
  const expire=()=>draft.controller?.abort();
  const resume=()=>{if(draft.items.some(item=>item.state==='failed'||item.state==='waiting'))void send();};
  const visible=()=>{if(!document.hidden){void refreshRef.current();resume();}};
  const leave=(event:BeforeUnloadEvent)=>{if(draft.busy){event.preventDefault();event.returnValue='';}};
  window.addEventListener('online',resume);document.addEventListener('visibilitychange',visible);
  window.addEventListener('mori:session-expired',expire);window.addEventListener('beforeunload',leave);
  return()=>{draft.listeners.delete(update);draft.controller?.abort();window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',visible);window.removeEventListener('mori:session-expired',expire);window.removeEventListener('beforeunload',leave);};
 },[draft]);
 function select(files:File[],remaining:number){
  if(draft.busy)return;
  const accepted=/\.(jpe?g|png|webp|heic|heif)$/i;
  draft.items=draft.items.filter(item=>item.state!=='saved'||!item.pageId||!knownIds.current.has(item.pageId));
  draft.items.push(...files.map(file=>({id:crypto.randomUUID(),file,state:'selected' as const,...(!accepted.test(file.name)?{state:'failed' as const,error:'사진 파일을 선택해 주세요.'}:{})})));
  setError(files.length>remaining?`${files.length-remaining}장 초과했어요. 사진은 그대로 두었으니 초과한 만큼 선택 해제해 주세요.`:'');changed();
 }
 async function remove(item:TransferItem){
  if(draft.busy)return;
  try{
   if(item.intent&&!item.pageId)throw new Error('전송 결과를 먼저 확인해야 해요. 연결 후 다시 보내기를 눌러 주세요.');
   if(item.pageId){const data=await api<Detail>(`/albums/${albumId}`);await api(`/albums/${albumId}/pages/${item.pageId}?expected_version=${data.detail.album.version}`,{method:'DELETE'});await refreshRef.current();}
   draft.items=draft.items.filter(row=>row.id!==item.id);changed();
  }catch(e){setError(errorText(e));}
 }
 return {items:draft.items,busy:draft.busy,error,select,send,remove};
}
