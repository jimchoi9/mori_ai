export interface DecodedPhoto {image:CanvasImageSource;width:number;height:number;close:()=>void}
type Reply={ok:true;image:ImageBitmap;width:number;height:number}|{ok:false;code:string};
const failure=(code='decode')=>new Error(code==='size'?'이 사진 크기를 처리하지 못했어요. 선택한 사진은 유지돼요.':code==='color'?'이 사진의 색상 형식을 처리하지 못했어요. 선택한 사진은 유지돼요.':'사진을 읽지 못했어요. 선택한 사진은 남겨 두었어요. (D1)');

/** Called inside the shared photoTask lane. A per-photo worker bounds lifetime and abort latency. */
export function decodeHeic(blob:Blob,signal:AbortSignal,maxEdge=2048):Promise<DecodedPhoto>{
 return new Promise((resolve,reject)=>{
  signal.throwIfAborted();
  let worker:Worker;try{worker=new Worker(new URL('./heicWorker.ts',import.meta.url),{type:'module'});}catch{reject(failure());return;}
  let settled=false;
  const clean=()=>{settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();};
  const fail=(error:unknown)=>{if(settled)return;clean();reject(error);};
  const cancel=()=>fail(signal.reason);
  const timer=setTimeout(()=>fail(failure()),30000);
  worker.onmessage=(event:MessageEvent<Reply>)=>{
   const result=event.data;
   if(settled||signal.aborted){if(result.ok)result.image.close();if(!settled)cancel();return;}
   if(!result.ok){fail(failure(result.code));return;}
   if(!result.width||!result.height||result.width*result.height>40_000_000||!result.image.width||!result.image.height||Math.max(result.image.width,result.image.height)>maxEdge){result.image.close();fail(failure('size'));return;}
   clean();resolve({image:result.image,width:result.width,height:result.height,close:()=>result.image.close()});
  };
  worker.onerror=()=>fail(failure());worker.onmessageerror=()=>fail(failure());
  signal.addEventListener('abort',cancel,{once:true});
  try{if(signal.aborted)cancel();else worker.postMessage({blob,maxEdge});}catch{fail(failure());}
 });
}
