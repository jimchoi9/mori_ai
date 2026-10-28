import {useEffect,useRef,useState} from 'react';
import type {MediaAccess} from '../../api/types';
import {previewPhoto} from './photoDecoder';
import {photoFailed,type UploadPhotoEntry} from './uploadMessages';

export function UploadPhoto({photo,access,label,onOpen,onRemove,disabled=false,overflow=0,large=false,reload}:{
 photo:UploadPhotoEntry;access?:MediaAccess;label:string;onOpen?:()=>void;onRemove?:()=>void;
 disabled?:boolean;overflow?:number;large?:boolean;reload:()=>void;
}){
 const [localUrl,setLocalUrl]=useState(''),[remoteFailed,setRemoteFailed]=useState(false);
 const automaticRefresh=useRef(false);
 const remoteUrl=access?.url,file=photo.item?.file;
 useEffect(()=>{automaticRefresh.current=false;},[photo.id]);
 useEffect(()=>setRemoteFailed(false),[remoteUrl]);
 useEffect(()=>{
  setLocalUrl('');
  if(!file||(remoteUrl&&!remoteFailed))return;
  const controller=new AbortController();let url='';
  void previewPhoto(file,controller.signal).then(blob=>{
   if(controller.signal.aborted)return;
   url=URL.createObjectURL(blob);setLocalUrl(url);
  }).catch(()=>undefined);
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[file,remoteUrl,remoteFailed]);
 const url=remoteUrl&&!remoteFailed?remoteUrl:localUrl;
 const media=<>{url?<img src={url} alt="" loading={file?'eager':'lazy'} onError={()=>{
  if(url!==remoteUrl)return;
  setRemoteFailed(true);
  if(!automaticRefresh.current){automaticRefresh.current=true;reload();}
 }}/>:<span className="easy-photo-placeholder">사진</span>}
 {overflow>0&&<span className="easy-photo-overflow" aria-hidden="true">+{overflow}</span>}
 {photoFailed(photo)&&<span className="easy-photo-attention" aria-hidden="true">확인 필요</span>}</>;
 return <div className={`easy-photo${photoFailed(photo)?' easy-photo--failed':''}${large?' easy-photo--large':''}`}>
  {onOpen?<button type="button" className="easy-photo-open" aria-label={label} onClick={onOpen}>{media}</button>:
   <div className="easy-photo-open" role="img" aria-label={label}>{media}</div>}
  {onRemove&&<button type="button" className="easy-photo-remove" disabled={disabled} aria-label={`${label} ${photo.item&&!photo.item.submitted?'선택 해제':'삭제'}`} onClick={onRemove}><span aria-hidden="true">×</span></button>}
  {remoteFailed&&!file&&<button type="button" className="easy-photo-reload" aria-label={`${label} 미리보기 다시 불러오기`} onClick={reload}>↻</button>}
 </div>;
}
