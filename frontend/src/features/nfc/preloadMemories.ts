import {download,type NfcBook} from './api';
export interface DownloadedMemory {text:string;src:string}
/** Small previews start first; only full pages/music gate opening the book. */
export async function preloadMemories(data:NfcBook,signal:AbortSignal,makeUrl:(blob:Blob)=>string,
 preview:(slot:number,src:string)=>void,progress:(loaded:number,total:number)=>void) {
 const count=Math.min(4,data.pages.length),shown=Array(count).fill(false),replaced=Array(count).fill(false);
 for(let slot=0;slot<count;slot++){
  const thumb=data.pages[slot].thumb;if(!thumb)continue;
  void download(thumb,data.session_token,signal).then(blob=>{
   if(signal.aborted||replaced[slot])return;
   shown[slot]=true;preview(slot,makeUrl(blob));
  }).catch(()=>undefined); // Optional previews never block a complete album.
 }
 const pages:DownloadedMemory[]=new Array(data.pages.length);let next=0,loaded=0;
 const worker=async()=>{while(next<data.pages.length){
  const index=next++,page=data.pages[index];
  const src=makeUrl(await download(page.src,data.session_token,signal));
  pages[index]={text:page.text,src};
  if(index<count&&!shown[index]){replaced[index]=true;shown[index]=true;preview(index,src);}
  loaded++;progress(loaded,data.pages.length);
  if(loaded%8===0&&count){const slot=Math.floor(loaded/8)%count;replaced[slot]=true;shown[slot]=true;preview(slot,src);}
 }};
 const musicReady=data.music_url?download(data.music_url,data.session_token,signal).then(makeUrl):Promise.resolve(null);
 const [music]=await Promise.all([musicReady,...Array.from({length:Math.min(4,data.pages.length)},worker)]);
 return {pages,music};
}
