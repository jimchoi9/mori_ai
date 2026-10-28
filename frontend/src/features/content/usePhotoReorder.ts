import {useEffect,useRef,useState,type PointerEvent, type RefObject} from 'react';
export function usePhotoReorder(list:RefObject<HTMLOListElement|null>,move:(from:string,to:string)=>void){
 const active=useRef<{id:string;y:number;start:number;target:string;dragged:boolean}|null>(null),callback=useRef(move);callback.current=move;
 const [target,setTarget]=useState<string|null>(null),frame=useRef(0),suppress=useRef(false);
 const stop=()=>{cancelAnimationFrame(frame.current);active.current=null;setTarget(null);};
 useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
 function tick(){const current=active.current;if(!current)return;
  if(current.dragged){const edge=90,delta=current.y<edge?-8:current.y>innerHeight-edge?8:0;if(delta)window.scrollBy(0,delta);
   const rows=Array.from(list.current?.querySelectorAll<HTMLElement>('[data-page]')??[]);
   const closest=rows.reduce<HTMLElement|null>((best,row)=>!best||Math.abs(row.getBoundingClientRect().top+row.clientHeight/2-current.y)<Math.abs(best.getBoundingClientRect().top+best.clientHeight/2-current.y)?row:best,null);
   if(closest){current.target=closest.dataset.page!;setTarget(current.target);}
  }frame.current=requestAnimationFrame(tick);
 }
 return {target,stop,suppressClick(){const result=suppress.current;suppress.current=false;return result;},
  down:(id:string,e:PointerEvent<HTMLButtonElement>)=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);active.current={id,start:e.clientY,y:e.clientY,target:id,dragged:false};frame.current=requestAnimationFrame(tick);},
  move:(e:PointerEvent<HTMLButtonElement>)=>{if(active.current){active.current.y=e.clientY;if(Math.abs(e.clientY-active.current.start)>8)active.current.dragged=true;}},
  up:(e:PointerEvent<HTMLButtonElement>)=>{const current=active.current;if(!current)return;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);suppress.current=current.dragged;stop();if(current.dragged&&current.id!==current.target)callback.current(current.id,current.target);}
 };
}
