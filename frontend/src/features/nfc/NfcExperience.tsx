import {useEffect,useRef,useState} from 'react';
import {captureEntry,clearEntry,enter,close,readerLibrary,type Entry,type NfcBook} from './api';
import {preloadMemories} from './preloadMemories';
import {LoadingScene} from './LoadingScene';
import {MemoryBook,type Chapter} from './MemoryBook';
import './nfc.css';
export function NfcExperience(){
 const entry=useRef<Entry|null|undefined>(undefined);if(entry.current===undefined)entry.current=captureEntry();
 const grant=useRef<NfcBook|null>(null),urls=useRef<string[]>([]);
 const [attempt,setAttempt]=useState(0),[state,setState]=useState<'loading'|'ready'|'preparing'|'error'|'ended'>(entry.current?'loading':'ended');
 const [error,setError]=useState(''),[previews,setPreviews]=useState<(string|null)[]>([]);
 const [progress,setProgress]=useState({loaded:0,total:0}),[showLoading,setShowLoading]=useState(!!entry.current);
 const [book,setBook]=useState<{chapters:Chapter[];music:string|null}|null>(null);
 useEffect(()=>{
  document.getElementById('nfc-bootstrap')?.remove();document.body.classList.add('nfc-mode');const previousTitle=document.title;document.title='그때의 우리 · Mori';const theme=document.querySelector('meta[name="theme-color"]');const previous=document.documentElement.dataset.nfc?'#faf9f6':theme?.getAttribute('content');theme?.setAttribute('content','#ead8bb');
  return()=>{document.body.classList.remove('nfc-mode');delete document.documentElement.dataset.nfc;document.title=previousTitle;if(previous)theme?.setAttribute('content',previous);};
 },[]);
 useEffect(()=>{
  clearEntry();
  if(!entry.current)return;
  const controller=new AbortController();let alive=true,expiry:ReturnType<typeof setTimeout>|undefined,exit:ReturnType<typeof setTimeout>|undefined;
  const release=()=>{urls.current.forEach(URL.revokeObjectURL);urls.current=[];};
  const end=()=>{controller.abort();if(grant.current){void close(grant.current.session_token);grant.current=null;}release();if(alive){setBook(null);setState('ended');}};
  const makeUrl=(blob:Blob)=>{controller.signal.throwIfAborted();const url=URL.createObjectURL(blob);urls.current.push(url);return url;};
  setState('loading');setError('');setPreviews([]);setProgress({loaded:0,total:0});setShowLoading(true);setBook(null);
  void(async()=>{
   try{
    const data=await enter(entry.current!,controller.signal);if(!alive)return;
    if(data.state==='preparing'){setState('preparing');return;}
    grant.current=data;
    expiry=setTimeout(end,Math.max(0,Date.parse(data.expires_at)-Date.now()));
    setPreviews(Array(Math.min(4,data.pages.length)).fill(null));
    setProgress({loaded:0,total:data.pages.length});
    const [loaded]=await Promise.all([preloadMemories(data,controller.signal,makeUrl,
     (slot,src)=>{if(alive)setPreviews(old=>{const next=[...old];next[slot]=src;return next;});},
     (loaded,total)=>{if(alive)setProgress({loaded,total});}),readerLibrary()]);
    const chapters:Chapter[]=loaded.pages.map((p,index)=>{const media=new Image();media.alt=`${index+1}번째 추억`;media.dataset.src=p.src;return {...p,media};});
    const music=loaded.music;
    if(!chapters.length)throw Error('아직 담긴 추억이 없어요.');
    await Promise.all(chapters.slice(0,2).map(async p=>{p.media.src=p.src;await p.media.decode();}));
    if(alive){setBook({chapters,music});setState('ready');exit=setTimeout(()=>{if(alive)setShowLoading(false);},900);}
   }catch(e){if(alive&&!controller.signal.aborted){controller.abort();release();if(grant.current){void close(grant.current.session_token);grant.current=null;}clearTimeout(expiry);setError(e instanceof Error?e.message:'추억을 불러오지 못했어요.');setState('error');}}
  })();
  addEventListener('pagehide',end);
  return()=>{alive=false;clearTimeout(expiry);clearTimeout(exit);removeEventListener('pagehide',end);end();};
 },[attempt]);
 return <main className="nfc-experience">{showLoading&&['loading','ready'].includes(state)&&<LoadingScene previews={previews} leaving={state==='ready'} loaded={progress.loaded} total={progress.total}/>}<div className={state==='ready'?'nfc-book-open':'nfc-book-hidden'}>{book&&<MemoryBook chapters={book.chapters} music={book.music}/>}</div>{!['loading','ready'].includes(state)&&<section className="nfc-message"><small>THE MOMENTS WE KEEP</small><h1>{state==='preparing'?'추억을 담고 있어요.':state==='ended'?'그날의 온기를 다시.':'잠시 기다려 주세요.'}</h1><p>{state==='preparing'?'앨범이 완성되면 굿즈의 NFC를 태그해 주세요.':state==='ended'?'굿즈의 NFC를 태그하면 추억책이 열립니다.':error}</p>{state==='error'&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>다시 불러오기</button>}</section>}</main>;
}
