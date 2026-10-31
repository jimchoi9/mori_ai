import {decodeHeic,type DecodedPhoto} from './heicDecoder';
// Preview and transport preparation share one decode lane on memory-limited phones.
interface Task {priority:number;run:()=>Promise<void>}
const tasks:Task[]=[];let running=false;
async function drain(){
 if(running)return;running=true;
 try{while(tasks.length){tasks.sort((a,b)=>b.priority-a.priority);await tasks.shift()!.run();}}
 finally{running=false;}
}
export function photoTask<T>(work:()=>Promise<T>,signal:AbortSignal,priority=1):Promise<T>{
 return new Promise((resolve,reject)=>{
  tasks.push({priority,run:async()=>{try{signal.throwIfAborted();resolve(await work());}catch(error){reject(error);}}});void drain();
 });
}
function imageElement(blob:Blob,signal:AbortSignal,timeout:number):Promise<HTMLImageElement>{
 return new Promise((resolve,reject)=>{
  const image=new Image(),url=URL.createObjectURL(blob);
  const clean=()=>{clearTimeout(timer);URL.revokeObjectURL(url);signal.removeEventListener('abort',cancel);image.onload=null;image.onerror=null;};
  const fail=(error:unknown)=>{clean();image.removeAttribute('src');reject(error);};
  const cancel=()=>fail(signal.reason),timer=setTimeout(()=>fail(new Error('photo decode timeout')),timeout);
  image.onload=()=>{clean();resolve(image);};image.onerror=()=>fail(new Error('photo decode failed'));
  signal.addEventListener('abort',cancel,{once:true});image.src=url;if(signal.aborted)cancel();
 });
}
/** Native formats stay native. Unsupported HEIC is decoded automatically by our web worker. */
export async function readPhoto(blob:Blob,signal:AbortSignal,bitmapFirst=false,maxEdge=2048,timeout=15000):Promise<DecodedPhoto>{
 signal.throwIfAborted();
 try{
  const image=bitmapFirst&&typeof createImageBitmap==='function'?await createImageBitmap(blob):await imageElement(blob,signal,timeout);
  const close=()=>{'close' in image?image.close():image.removeAttribute('src');};
  if(signal.aborted){close();signal.throwIfAborted();}
  return {image,width:'naturalWidth' in image?image.naturalWidth:image.width,height:'naturalHeight' in image?image.naturalHeight:image.height,close};
 }catch(error){
  signal.throwIfAborted();
  if(!['image/heic','image/heif'].includes(blob.type))throw error;
  return decodeHeic(blob,signal,maxEdge);
 }
}
export function previewPhoto(file:File,signal:AbortSignal):Promise<Blob>{
 return photoTask(async()=>{
  if(file.size>20*1024*1024)throw Error('preview unavailable');
  const mime=/\.hei[cf]$/i.test(file.name)&&!['image/heic','image/heif'].includes(file.type)?'image/heic':file.type;
  const blob=mime===file.type?file:new Blob([file],{type:mime});
  const image=await readPhoto(blob,signal,false,256,8000);let canvas:HTMLCanvasElement|undefined;
  try{
   signal.throwIfAborted();if(!image.width||!image.height||image.width*image.height>40_000_000)throw Error('preview unavailable');
   const ratio=Math.min(1,256/Math.max(image.width,image.height));
   canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
   const context=canvas.getContext('2d');if(!context)throw Error('preview unavailable');
   context.drawImage(image.image,0,0,canvas.width,canvas.height);
   return await new Promise<Blob>((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
    const cancel=()=>{clean();reject(signal.reason);},timer=setTimeout(()=>{clean();reject(Error('preview timeout'));},8000);
    signal.addEventListener('abort',cancel,{once:true});
    try{canvas!.toBlob(blob=>{clean();if(signal.aborted)reject(signal.reason);else if(blob)resolve(blob);else reject(Error('preview unavailable'));},'image/webp',.7);}catch(error){clean();reject(error);}
    if(signal.aborted)cancel();
   });
  }finally{image.close();if(canvas){canvas.width=0;canvas.height=0;}}
 },signal,0);
}

let nativeWebp:boolean|undefined;
let software:Promise<(data:ImageData,options?:{quality:number})=>Promise<ArrayBuffer>>|undefined;
function encoder(){
 if(!software)software=import('@jsquash/webp/encode.js').then(async module=>{await module.init();return module.default;}).catch(error=>{software=undefined;throw error;});
 return software;
}
function abortable<T>(job:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{clean();reject(signal.reason);};
  const timer=setTimeout(()=>{clean();reject(new Error('사진 압축 도구를 준비하지 못했어요. 연결을 확인해 주세요.'));},30000);
  signal.addEventListener('abort',cancel,{once:true});
  job.then(value=>{clean();resolve(value);},error=>{clean();reject(error);});if(signal.aborted)cancel();
 });
}
async function softwareBlob(canvas:HTMLCanvasElement,quality:number,signal:AbortSignal){
 const encode=await abortable(encoder(),signal);signal.throwIfAborted();
 const context=canvas.getContext('2d');if(!context)throw new Error('사진 준비 공간을 만들지 못했어요.');
 // Read only the already resized surface, never the full-resolution source.
 const pixels=context.getImageData(0,0,canvas.width,canvas.height);
 const bytes=await encode(pixels,{quality:quality*100});signal.throwIfAborted();
 return new Blob([bytes],{type:'image/webp'});
}
export async function canvasBlob(canvas:HTMLCanvasElement,quality:number,signal:AbortSignal):Promise<Blob|null>{
 signal.throwIfAborted();
 if(nativeWebp===false)return softwareBlob(canvas,quality,signal);
 const blob=await new Promise<Blob|null>((resolve,reject)=>{
  const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};
  const cancel=()=>{clean();reject(signal.reason);};
  const timer=setTimeout(()=>{clean();reject(new Error('사진 준비 시간이 초과됐어요.'));},10000);
  signal.addEventListener('abort',cancel,{once:true});
  try{canvas.toBlob(blob=>{clean();if(signal.aborted)reject(signal.reason);else resolve(blob);},'image/webp',quality);}catch(error){clean();reject(error);}
  if(signal.aborted)cancel();
 });
 if(blob?.type==='image/webp'){nativeWebp=true;return blob;}
 if(blob){nativeWebp=false;return softwareBlob(canvas,quality,signal);}
 return blob;
}
