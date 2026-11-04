import {useEffect,useRef,useState} from 'react';
import {createBookPhotos} from './bookPhotos';
import {createBookEnding,readBookPosition,rememberBookPosition} from './bookEnding';
import './bookEnding.css';
export interface Chapter {text:string;src:string;media:HTMLImageElement}
interface BookHandle {first:()=>void;destroy:()=>void}
declare global {interface Window {createMemoryBook:(host:HTMLElement,options:{reduced:boolean;chapters:Chapter[];ending?:(part:'full'|'cover'|'actions')=>HTMLElement;startIndex?:number;onTurn:(index:number)=>void;onPage:(index:number)=>void})=>BookHandle}}
export function MemoryBook({chapters,music,title}:{chapters:Chapter[];music:string|null;title:string}) {
 const host=useRef<HTMLDivElement>(null),audio=useRef<HTMLAudioElement>(null);
 const [sound,setSound]=useState<'ready'|'playing'|'muted'|'error'>('ready');
 const enabled=useRef(true),started=useRef(false),alive=useRef(true);
 function start(){const a=audio.current;if(!a||!enabled.current||document.hidden)return;a.volume=.25;void a.play().then(()=>{if(alive.current){started.current=true;setSound('playing');}}).catch(()=>{if(alive.current)setSound('error');});}
 useEffect(()=>{
  alive.current=true;
  const photos=createBookPhotos(chapters);
  const nearby=(index:number)=>photos.nearby(Math.min(index,chapters.length-1));
  let book:BookHandle;
  const ending=createBookEnding(title,()=>{book.first();start();});
  book=window.createMemoryBook(host.current!,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,ending,startIndex:readBookPosition(chapters.length),onTurn:index=>{nearby(index);start();},onPage:index=>{nearby(index);rememberBookPosition(index);}});
  const pause=()=>audio.current?.pause();
  const visibility=()=>{if(document.hidden)pause();else if(started.current&&enabled.current)start();};document.addEventListener('visibilitychange',visibility);addEventListener('pagehide',pause);
  return()=>{alive.current=false;photos.destroy();book.destroy();pause();document.removeEventListener('visibilitychange',visibility);removeEventListener('pagehide',pause);};
 },[chapters,title]);
 return <><div className="nfc-reader" ref={host} aria-label="추억책"/>{music&&<><audio ref={audio} src={music} loop preload="auto"/><button className="nfc-sound" type="button" aria-pressed={sound==='playing'} aria-label={sound==='playing'?'음악 끄기':sound==='error'?'소리 재생 다시 시도':'음악 켜기'} onClick={()=>{if(sound==='playing'){enabled.current=false;audio.current?.pause();setSound('muted');}else{enabled.current=true;start();}}}>{sound==='error'?'소리 재시도':sound==='muted'?'소리 꺼짐':'♪ 소리'}</button></>}</>;
}
