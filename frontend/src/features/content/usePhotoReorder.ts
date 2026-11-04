import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createPhotoReorder,type ReorderOptions} from './reorder/controller';
export function usePhotoReorder(list:RefObject<HTMLOListElement|null>,options:Omit<ReorderOptions,'phase'>&{phase:(interacting:boolean)=>void}){
 const ctx=useRef(options);ctx.current=options;
 const alive=useRef(true),binding=useRef<{node:HTMLOListElement;controller:ReturnType<typeof createPhotoReorder>}|null>(null);
 const [state,setState]=useState({interacting:false,dragging:false});
 const phase=(interacting:boolean,dragging:boolean)=>{ctx.current.phase(interacting);if(alive.current)setState(old=>old.interacting===interacting&&old.dragging===dragging?old:{interacting,dragging});};
 useLayoutEffect(()=>{
  if(binding.current?.node!==list.current){binding.current?.controller.dispose();binding.current=list.current?{node:list.current,controller:createPhotoReorder(list.current,()=>({...ctx.current,phase}))}:null;}
  binding.current?.controller.sync();
 });
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;binding.current?.controller.dispose();binding.current=null;};},[]);
 return {...state,stop:()=>binding.current?.controller.stop()};
}
