import {useEffect,useRef,useState} from 'react';
import {api,errorText} from '../../api/client';
import type {Detail,Page} from '../../api/types';
import {captionValue} from '../generation/flow';
import {useUnsavedGuard} from '../review/useUnsavedGuard';
interface Draft {text:string;baseline:string;version:number;error?:string;conflict?:Page}
export function useCaptionEdits(albumId:string,pages:Page[],refresh:()=>Promise<unknown>){
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[saving,setSaving]=useState(0);
 const ref=useRef(drafts);ref.current=drafts;
 const active=useRef(new Map<string,Promise<void>>()),alive=useRef(true);
 const controller=useRef(new AbortController());
 useEffect(()=>{alive.current=true;const clear=()=>{controller.current.abort();};window.addEventListener('mori:logout',clear);window.addEventListener('mori:session-expired',clear);return()=>{alive.current=false;clear();window.removeEventListener('mori:logout',clear);window.removeEventListener('mori:session-expired',clear);};},[]);
 useEffect(()=>{setDrafts(old=>{
  const next:Record<string,Draft>={};
  for(const p of pages){const d=old[p.id];
   if(!d||d.text===d.baseline&&!active.current.has(p.id))next[p.id]={text:p.caption_text??'',baseline:p.caption_text??'',version:p.version};
   else if(p.caption_edited===false&&!active.current.has(p.id))next[p.id]={...d,baseline:p.caption_text??'',version:p.version};
   else next[p.id]=p.version!==d.version&&p.caption_text!==d.baseline&&!active.current.has(p.id)?{...d,conflict:p,error:'다른 곳에서 글귀가 바뀌었어요.'}:p.caption_text===d.baseline?{...d,version:p.version}:d;
  }return next;
 });},[pages]);
 const dirty=Object.values(drafts).some(d=>d.text!==d.baseline);
 useUnsavedGuard(dirty,()=>setDrafts({}));
 function change(id:string,text:string){setDrafts(old=>({...old,[id]:{...old[id],text,error:undefined}}));}
 async function save(id:string):Promise<void>{
  const previous=active.current.get(id);if(previous)return previous;
  const draft=ref.current[id];if(!draft||draft.text===draft.baseline||draft.conflict||!captionValue(draft.text).valid)return;
  const text=captionValue(draft.text).text;
  const work=(async()=>{
   setSaving(n=>n+1);
   try{
    const result=await api<{page:Page}>(`/albums/${albumId}/pages/${id}/caption`,{method:'PATCH',body:{expected_version:draft.version,caption_text:text},signal:controller.current.signal});
    if(alive.current){setDrafts(old=>({...old,[id]:{...old[id],baseline:text,version:result.page.version,error:undefined}}));await refresh();}
   }catch(e){
    if(!alive.current||controller.current.signal.aborted)return;
    const fresh=await api<Detail>(`/albums/${albumId}`,{signal:controller.current.signal}).catch(()=>null);
    const page=fresh?.detail.pages.find(p=>p.id===id);
    setDrafts(old=>({...old,[id]:{...old[id],error:errorText(e),...(page&&page.caption_text!==draft.baseline?{conflict:page}:page?{version:page.version}:{})}}));
   }finally{active.current.delete(id);if(alive.current)setSaving(n=>n-1);}
  })();active.current.set(id,work);return work;
 }
 useEffect(()=>{const timer=window.setTimeout(()=>{for(const [id,d] of Object.entries(drafts))if(d.text!==d.baseline&&!d.error&&!d.conflict)void save(id);},800);return()=>clearTimeout(timer);},[drafts]);
 async function flush(){
  for(let pass=0;pass<3;pass++){
   await Promise.all([...active.current.values()]);
   const ids=Object.keys(ref.current).filter(id=>ref.current[id].text!==ref.current[id].baseline&&!ref.current[id].conflict);
   if(!ids.length)break;
   await Promise.all(ids.map(save));
   // Let React publish successful baselines before examining the next pass.
   await new Promise<void>(resolve=>window.setTimeout(resolve,0));
  }
  return !Object.values(ref.current).some(d=>d.text!==d.baseline||d.conflict);
 }
 function resolve(id:string,keep:boolean){setDrafts(old=>{const d=old[id],p=d.conflict!;return {...old,[id]:{text:keep?d.text:p.caption_text??'',baseline:p.caption_text??'',version:p.version}};});}
 return {drafts,dirty,saving,change,save,flush,resolve};
}
