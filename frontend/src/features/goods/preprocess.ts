import {inspectImage,resizeDimensions} from '../uploads/preprocess';

export const goodsSourceAccept='image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif';
const text=(bytes:Uint8Array)=>String.fromCharCode(...bytes);
// Only a single basic VP8/VP8L image with no metadata is a browser candidate.
// Extended WebP (ICC, EXIF, animation, HDR) remains on the server path.
function inspectWebp(bytes:Uint8Array){
 try{
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(text(bytes.subarray(0,4))!=='RIFF'||text(bytes.subarray(8,12))!=='WEBP'||d.getUint32(4,true)+8!==bytes.length)return null;
  const kind=text(bytes.subarray(12,16)),size=d.getUint32(16,true);
  if(20+size+(size%2)!==bytes.length)return null;
  let width=0,height=0;
  if(kind==='VP8 '&&size>=10&&!(bytes[20]&1)&&text(bytes.subarray(23,26))==='\x9d\x01\x2a'){width=d.getUint16(26,true)&16383;height=d.getUint16(28,true)&16383;}
  if(kind==='VP8L'&&size>=5&&bytes[20]===47){const bits=d.getUint32(21,true);if(bits>>>29)return null;width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  if(!width||!height||width*height>12_000_000)return null;
  return {width,height,orientation:1,omit:[] as [number,number][]};
 }catch{return null;}
}
export async function prepareGoodsSource(file:File,signal:AbortSignal):Promise<File>{
 signal.throwIfAborted();
 if(file.size>20*1024*1024)throw Error('20MiB 이하 사진 1장을 선택해 주세요.');
 let bitmap:ImageBitmap|undefined,canvas:HTMLCanvasElement|undefined;
 try{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||typeof createImageBitmap!=='function'||typeof document==='undefined')return file;
  const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
  const info=file.type==='image/webp'?inspectWebp(bytes):inspectImage(bytes,file.type,file.type==='image/jpeg'?40_000_000:12_000_000);
  if(!info)return file;
  const pieces:BlobPart[]=[];let start=0;
  for(const [from,to] of info.omit){pieces.push(file.slice(start,from));start=to;}pieces.push(file.slice(start));
  const [decodedWidth,decodedHeight]=resizeDimensions(info.width,info.height);
  // Resize requests bound returned surfaces, not decoder peak RAM. High-resolution
  // PNG/WebP remain server-only; JPEG peak usage still needs device validation.
  bitmap=await createImageBitmap(new Blob(pieces,{type:file.type}),{resizeWidth:decodedWidth,resizeHeight:decodedHeight,resizeQuality:'high'});
  signal.throwIfAborted();
  if(bitmap.width!==decodedWidth||bitmap.height!==decodedHeight)return file;
  const rotated=info.orientation>=5,width=rotated?decodedHeight:decodedWidth,height=rotated?decodedWidth:decodedHeight;
  canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)return file;
  const matrices=[[1,0,0,1,0,0],[-1,0,0,1,width,0],[-1,0,0,-1,width,height],[1,0,0,-1,0,height],[0,1,1,0,0,0],[0,1,-1,0,width,0],[0,-1,-1,0,width,height],[0,-1,1,0,0,height]];
  const m=matrices[info.orientation-1];ctx.transform(m[0],m[1],m[2],m[3],m[4],m[5]);ctx.drawImage(bitmap,0,0,decodedWidth,decodedHeight);
  const blob=await new Promise<Blob|null>(resolve=>canvas!.toBlob(resolve,'image/webp',.85));signal.throwIfAborted();
  if(!blob||blob.type!=='image/webp'||!blob.size||blob.size>=file.size)return file;
  const header=new Uint8Array(await blob.slice(0,12).arrayBuffer());signal.throwIfAborted();
  if(text(header.subarray(0,4))!=='RIFF'||text(header.subarray(8,12))!=='WEBP')return file;
  return new File([blob],file.name.replace(/\.[^.]*$/,'')+'.webp',{type:'image/webp',lastModified:file.lastModified});
 }catch{signal.throwIfAborted();return file;}
 finally{bitmap?.close();if(canvas){canvas.width=0;canvas.height=0;}}
}
