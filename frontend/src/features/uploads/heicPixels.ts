import {heicIccColorSpace} from './heicColor';

interface HeifImage {
 handle:{$$:{ptr:number}};
 get_width():number;get_height():number;is_primary():boolean;free():void;
 display(data:{width:number;height:number;data:Uint8ClampedArray},done:(data:{width:number;height:number;data:Uint8ClampedArray}|null)=>void):void;
}
interface HeifDecoder {decoder:unknown;decode(bytes:Uint8Array):HeifImage[]}
/** The C ABI and Embind handle pointer below are pinned to libheif-js 1.23.5. */
export interface HeifModule {
 HeifDecoder:new()=>HeifDecoder;heif_context_free(context:unknown):void;
 HEAPU8:Uint8Array;HEAPU32:Uint32Array;
 _malloc(size:number):number;_free(ptr:number):void;
 _heif_image_handle_get_luma_bits_per_pixel(handle:number):number;
 _heif_image_handle_get_chroma_bits_per_pixel(handle:number):number;
 _heif_image_handle_get_raw_color_profile_size(handle:number):number;
 _heif_image_handle_get_raw_color_profile(error:number,handle:number,out:number):void;
 _heif_image_handle_get_nclx_color_profile(error:number,handle:number,out:number):void;
 _heif_nclx_color_profile_free(ptr:number):void;
}
export class HeicDecodeError extends Error {
 code:'size'|'color'|'decode';
 constructor(code:'size'|'color'|'decode'){super(code);this.code=code;}
}
function colorSpace(lib:HeifModule,handle:number):PredefinedColorSpace {
 const error=lib._malloc(12),out=lib._malloc(4);let nclx=0,icc=0;
 try{
  lib.HEAPU32[out/4]=0;lib._heif_image_handle_get_nclx_color_profile(error,handle,out);
  const code=lib.HEAPU32[error/4];nclx=lib.HEAPU32[out/4];
  if(code!==0&&code!==10)throw new HeicDecodeError('color'); // 10: profile does not exist.
  let primaries=2,transfer=2;
  if(code===0){
   if(!nclx||lib.HEAPU8[nclx]!==1)throw new HeicDecodeError('color');
   primaries=lib.HEAPU32[(nclx+4)/4];transfer=lib.HEAPU32[(nclx+8)/4];
   if(![2,13].includes(transfer))throw new HeicDecodeError('color');
  }
  const size=lib._heif_image_handle_get_raw_color_profile_size(handle);
  if(size){
   if(size>1_048_576)throw new HeicDecodeError('color');
   icc=lib._malloc(size);lib._heif_image_handle_get_raw_color_profile(error,handle,icc);
   if(lib.HEAPU32[error/4]!==0)throw new HeicDecodeError('color');
   try{return heicIccColorSpace(lib.HEAPU8.subarray(icc,icc+size));}catch{throw new HeicDecodeError('color');}
  }
  if([1,2].includes(primaries))return 'srgb';
  if(primaries===12&&transfer===13)return 'display-p3';
  throw new HeicDecodeError('color');
 }finally{if(nclx)lib._heif_nclx_color_profile_free(nclx);if(icc)lib._free(icc);lib._free(out);lib._free(error);}
}

/** Decode only the primary image. Validate dimensions/color before allocating its RGBA surface. */
export async function decodeHeicPixels(lib:HeifModule,bytes:Uint8Array){
 if(bytes.length>20*1024*1024)throw new HeicDecodeError('size');
 const decoder=new lib.HeifDecoder();let images:HeifImage[]=[];
 try{
  images=decoder.decode(bytes);const image=images.find(image=>image.is_primary());
  if(!image)throw new HeicDecodeError('decode');
  const width=image.get_width(),height=image.get_height(),handle=image.handle.$$.ptr;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width*height>40_000_000)throw new HeicDecodeError('size');
  if(lib._heif_image_handle_get_luma_bits_per_pixel(handle)!==8||lib._heif_image_handle_get_chroma_bits_per_pixel(handle)!==8)throw new HeicDecodeError('color');
  const space=colorSpace(lib,handle),data=new Uint8ClampedArray(width*height*4);
  await new Promise<void>((resolve,reject)=>image.display({width,height,data},result=>{
   if(!result||result.width!==width||result.height!==height)reject(new HeicDecodeError('decode'));else resolve();
  }));
  return {width,height,data,colorSpace:space};
 }finally{for(const image of images)image.free();if(decoder.decoder)lib.heif_context_free(decoder.decoder);}
}
