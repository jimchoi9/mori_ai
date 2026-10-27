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
export function previewPhoto(file:File,signal:AbortSignal):Promise<Blob>{
 return photoTask(()=>new Promise<Blob>((resolve,reject)=>{
  const image=new Image(),url=URL.createObjectURL(file);let canvas:HTMLCanvasElement|undefined;
  const clean=()=>{clearTimeout(timer);image.onload=null;image.onerror=null;image.removeAttribute('src');URL.revokeObjectURL(url);if(canvas){canvas.width=0;canvas.height=0;}signal.removeEventListener('abort',cancel);};
  const fail=(error:unknown)=>{clean();reject(error);};
  const cancel=()=>fail(signal.reason),timer=setTimeout(()=>fail(new Error('preview timeout')),8000);
  image.onerror=()=>fail(new Error('preview unavailable'));
  image.onload=()=>{
   try{
    signal.throwIfAborted();const ratio=Math.min(1,256/Math.max(image.naturalWidth,image.naturalHeight));
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const context=canvas.getContext('2d');if(!context)throw Error('preview unavailable');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    canvas.toBlob(blob=>{if(signal.aborted){fail(signal.reason);return;}if(!blob){fail(Error('preview unavailable'));return;}clean();resolve(blob);},'image/webp',.7);
   }catch(error){fail(error);}
  };
  signal.addEventListener('abort',cancel,{once:true});image.src=url;if(signal.aborted)cancel();
 }),signal,0);
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
