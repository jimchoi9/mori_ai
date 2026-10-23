import {useEffect,useRef,type ReactNode} from 'react';

/** Native modal focus, Escape and focus restoration stay with the browser. */
export function GoodsDialog({open,label,onClose,children,kind='example',locked=false}:{open:boolean;label:string;onClose:()=>void;children:ReactNode;kind?:'example'|'mockup'|'login';locked?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;if(!open||!dialog)return;
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  dialog.showModal();
  return()=>{dialog.close();document.body.style.overflow=overflow;};
 },[open]);
 return <dialog ref={ref} aria-label={label} className={`goods-dialog goods-dialog--${kind}`} onCancel={e=>{e.preventDefault();if(!locked)onClose();}} onClick={e=>{if(e.target===e.currentTarget&&!locked)onClose();}}>
  {open&&<div className="goods-dialog-content">{children}</div>}
 </dialog>;
}
