import {inspectImage,resizeDimensions} from '../uploads/preprocess';
import {photoTask,readPhoto,canvasBlob} from '../uploads/photoDecoder';
import type {DecodedPhoto} from '../uploads/heicDecoder';
import {inspectGoodsSource} from './sourceImage';

export const goodsSourceAccept='image/png,image/jpeg,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
const MAX_BYTES=20*1024*1024,MAX_PIXELS=40_000_000;

/** Goods keep their own output policy, sharing the album decoder/encoder and single lane. */
async function prepare(file:File,signal:AbortSignal):Promise<File>{
 signal.throwIfAborted();
 if(file.size>MAX_BYTES)throw Error('20MiB 이하 사진 1장을 선택해 주세요.');
 const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
 const source=inspectGoodsSource(bytes),info=inspectImage(bytes,source.mime,Number.MAX_SAFE_INTEGER);
 const width=info?.width??source.width,height=info?.height??source.height;
 if(width&&height&&width*height>MAX_PIXELS)throw Error('4,000만 화소 이하 사진을 선택해 주세요.');
 const pieces:BlobPart[]=[];let start=0;
 for(const [from,to] of info?.omit??[]){pieces.push(file.slice(start,from));start=to;}pieces.push(file.slice(start));
 const blob=new Blob(pieces,{type:source.mime});
 const size=info?resizeDimensions(info.width,info.height):null;
 let last:unknown,stage='decode';
 for(let attempt=0;attempt<2;attempt++){
  let image:DecodedPhoto|undefined,canvas:HTMLCanvasElement|undefined;
  try{
   stage='decode';signal.throwIfAborted();
   image=await readPhoto(blob,signal,!!info&&attempt===0,2048,15000,size?{width:size[0],height:size[1]}:undefined);
   signal.throwIfAborted();
   if(!image.width||!image.height||image.width*image.height>MAX_PIXELS)throw Error('4,000만 화소 이하 사진을 선택해 주세요.');
   const orientation=info?.orientation??1,rotated=orientation>=5;
   const [w,h]=resizeDimensions(rotated?image.height:image.width,rotated?image.width:image.height);
   canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('사진 준비 공간을 만들지 못했어요.');
   const matrices=[[1,0,0,1,0,0],[-1,0,0,1,w,0],[-1,0,0,-1,w,h],[1,0,0,-1,0,h],[0,1,1,0,0,0],[0,1,-1,0,w,0],[0,-1,-1,0,w,h],[0,-1,1,0,0,h]];
   const m=matrices[orientation-1];ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5]);
   ctx.drawImage(image.image,0,0,rotated?h:w,rotated?w:h);
   stage='encode';
   const output=await canvasBlob(canvas,.85,signal);signal.throwIfAborted();
   if(!output||output.type!=='image/webp'||!output.size||output.size>MAX_BYTES)throw Error('사진 압축 실패');
   const header=new Uint8Array(await output.slice(0,12).arrayBuffer());signal.throwIfAborted();
   if(String.fromCharCode(...header.slice(0,4))!=='RIFF'||String.fromCharCode(...header.slice(8,12))!=='WEBP')throw Error('사진 압축 실패');
   return new File([output],file.name.replace(/\.[^.]*$/,'')+'.webp',{type:'image/webp',lastModified:file.lastModified});
  }catch(error){signal.throwIfAborted();last=error;}
  finally{image?.close();if(canvas){canvas.width=0;canvas.height=0;}}
 }
 if(last instanceof Error&&/색상|화소|크기/.test(last.message))throw last;
 throw Error(stage==='encode'?'사진을 압축하지 못했어요. 다시 시도해 주세요. (E1)':'사진을 읽지 못했어요. 다시 시도해 주세요. (D1)');
}

export function prepareGoodsSource(file:File,signal:AbortSignal):Promise<File>{
 return photoTask(()=>prepare(file,signal),signal);
}
