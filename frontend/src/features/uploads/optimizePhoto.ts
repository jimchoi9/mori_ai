import {photoTask,canvasBlob,readPhoto} from './photoDecoder';
import type {DecodedPhoto} from './heicDecoder';
import {captureHints,inspectImage,resizeDimensions,type PreparedFile} from './preprocess';

const MAX_BYTES=20*1024*1024,MAX_PIXELS=40_000_000;
const pause=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},120);
 signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
});

/** One decoder at a time; output always meets transport policy, never the original file. */
async function optimize(file:File,signal:AbortSignal):Promise<PreparedFile> {
 signal.throwIfAborted();
 if(file.size>MAX_BYTES)throw new Error('한 장이 20MiB를 넘어요. 선택한 사진은 그대로 남겨 두었어요.');
 const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
 const ascii=(from:number,to:number)=>String.fromCharCode(...bytes.slice(from,to));
 const mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes[0]===137&&bytes[1]===80?'image/png':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':file.type||(/\.hei[cf]$/i.test(file.name)?'image/heic':'');
 if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(mime))throw new Error('JPEG·PNG·WebP·HEIC 사진을 선택해 주세요. 선택한 파일은 유지돼요.');
 const info=inspectImage(bytes,mime,Number.MAX_SAFE_INTEGER),capture=info??captureHints(bytes,mime);
 if(info&&info.width*info.height>MAX_PIXELS)throw new Error('이 사진 크기를 처리하지 못했어요. 선택한 사진은 유지돼요.');
 const parts:BlobPart[]=[];let offset=0;
 for(const [from,to] of info?.omit??[]){parts.push(file.slice(offset,from));offset=to;}parts.push(file.slice(offset));
 const blob=new Blob(parts,{type:mime||file.type});
 let lastError:unknown,stage='decode';
 // Fresh surfaces retry transient failures. Safe JPEG/PNG use bitmap first;
 // HTMLImageElement also covers HEIC where the browser's native decoder supports it.
 for(let attempt=0;attempt<3;attempt++){
  let image:DecodedPhoto|undefined,canvas:HTMLCanvasElement|undefined;
  try{
   signal.throwIfAborted();stage='decode';if(attempt)await pause(signal);
   image=await readPhoto(blob,signal,!!(info?attempt<2:attempt===2));
   signal.throwIfAborted();
   const {width,height}=image;
   if(!width||!height||width*height>MAX_PIXELS)throw new Error('이 사진 크기를 처리하지 못했어요. 선택한 사진은 유지돼요.');
   const orientation=info?.orientation??1,rotated=orientation>=5;
   const originalWidth=rotated?height:width,originalHeight=rotated?width:height;
   if(info&&(width!==info.width||height!==info.height))throw new Error('사진 방향을 확인하지 못했어요.');
   async function encode(edge:number,quality:number){
    signal.throwIfAborted();
    const [w,h]=resizeDimensions(originalWidth,originalHeight,edge);
    canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('사진 준비 공간을 만들지 못했어요.');
    const matrices=[[1,0,0,1,0,0],[-1,0,0,1,w,0],[-1,0,0,-1,w,h],[1,0,0,-1,0,h],[0,1,1,0,0,0],[0,1,-1,0,w,0],[0,-1,-1,0,w,h],[0,-1,1,0,0,h]];
    const m=matrices[orientation-1];ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5]);
    ctx.drawImage(image!.image,0,0,rotated?h:w,rotated?w:h);
    try{
     const result=await canvasBlob(canvas,quality,signal);signal.throwIfAborted();
     if(!result||result.type!=='image/webp'||!result.size)throw new Error('사진을 전송용으로 준비하지 못했어요.');
     const header=new Uint8Array(await result.slice(0,12).arrayBuffer());
     if(String.fromCharCode(...header.slice(0,4))!=='RIFF'||String.fromCharCode(...header.slice(8,12))!=='WEBP')throw new Error('사진 형식을 확인하지 못했어요.');
     return result;
    }finally{canvas.width=0;canvas.height=0;canvas=undefined;}
   }
   stage='encode';
   let edge=Math.min(2048,Math.max(originalWidth,originalHeight));const minimum=Math.min(1024,edge);
   let body=await encode(edge,.85);
   while(body.size>1_000_000&&edge>minimum){edge=Math.max(minimum,Math.floor(edge*.8));body=await encode(edge,.85);}
   if(body.size>1_000_000)throw new Error('사진 용량을 충분히 줄이지 못했어요. 선택한 사진은 유지돼요.');
   let thumbnail:Blob|undefined;
   try{const thumb=await encode(480,.8);if(thumb.size<=200_000)thumbnail=thumb;}catch{signal.throwIfAborted();}
   const make=(data:Blob,suffix='')=>new File([data],file.name.replace(/\.[^.]*$/,'')+suffix+'.webp',{type:'image/webp',lastModified:file.lastModified});
   return {file:make(body),...(thumbnail?{thumbnail:make(thumbnail,'.thumb')}:{ }),preprocessing:{version:2,original_width:originalWidth,original_height:originalHeight,captured_at_raw:capture.date,captured_timezone:capture.timezone}};
  }catch(error){signal.throwIfAborted();lastError=error;}
  finally{image?.close();if(canvas){canvas.width=0;canvas.height=0;}}
 }
 throw new Error(lastError instanceof Error&&lastError.message.includes('유지')?lastError.message:stage==='encode'?'사진을 압축하지 못했어요. 선택한 사진은 남겨 두었어요. (E1)':'사진을 읽지 못했어요. 선택한 사진은 남겨 두었어요. (D1)');
}

export function optimizePhoto(file:File,signal:AbortSignal){return photoTask(()=>optimize(file,signal),signal);}
