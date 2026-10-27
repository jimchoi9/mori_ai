import {useEffect,useRef,useState} from 'react';
export interface Chapter {text:string;src:string;media:HTMLImageElement}
declare global {interface Window {createMemoryBook:(host:HTMLElement,options:{reduced:boolean;chapters:Chapter[];onTurn:(index:number)=>void;onPage:(index:number)=>void})=>{destroy:()=>void}}}
export function MemoryBook({chapters,music}:{chapters:Chapter[];music:string|null}) {
 const host=useRef<HTMLDivElement>(null),audio=useRef<HTMLAudioElement>(null);
 const [sound,setSound]=useState<'ready'|'playing'|'muted'|'error'>('ready');
 const enabled=useRef(true),started=useRef(false),alive=useRef(true);
 function start(){const a=audio.current;if(!a||!enabled.current||document.hidden)return;a.volume=.25;void a.play().then(()=>{if(alive.current){started.current=true;setSound('playing');}}).catch(()=>{if(alive.current)setSound('error');});}
 useEffect(()=>{
  alive.current=true;
  const nearby=(index:number)=>chapters.forEach((p,i)=>{if(Math.abs(i-index)<=1){if(!p.media.getAttribute('src'))p.media.src=p.src;}else p.media.removeAttribute('src');});
  const book=window.createMemoryBook(host.current!,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,onTurn:index=>{nearby(index);start();},onPage:nearby});
  const pause=()=>audio.current?.pause();
  const visibility=()=>{if(document.hidden)pause();else if(started.current&&enabled.current)start();};document.addEventListener('visibilitychange',visibility);addEventListener('pagehide',pause);
  return()=>{alive.current=false;book.destroy();pause();document.removeEventListener('visibilitychange',visibility);removeEventListener('pagehide',pause);};
 },[chapters]);
 return <><div className="nfc-reader" ref={host} aria-label="추억책"/>{music&&<><audio ref={audio} src={music} loop preload="auto"/><button className="nfc-sound" type="button" aria-pressed={sound==='playing'} aria-label={sound==='playing'?'음악 끄기':sound==='error'?'소리 재생 다시 시도':'음악 켜기'} onClick={()=>{if(sound==='playing'){enabled.current=false;audio.current?.pause();setSound('muted');}else{enabled.current=true;start();}}}>{sound==='error'?'소리 재시도':sound==='muted'?'소리 꺼짐':'♪ 소리'}</button></>}</>;
}
