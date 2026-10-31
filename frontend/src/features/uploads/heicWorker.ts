import codecUrl from 'libheif-js/libheif-wasm/libheif-bundle.mjs?url&no-inline';
import {decodeHeicPixels,HeicDecodeError,type HeifModule} from './heicPixels';
import {resizeDimensions} from './preprocess';

self.onmessage=async(event:MessageEvent<{blob:Blob;maxEdge:number}>)=>{
 let image:ImageBitmap|undefined;
 try{
  // Keep the LGPL codec byte-for-byte, separately loadable/replacable from our application.
  const {default:factory}=await import(/* @vite-ignore */ codecUrl);
  const lib:HeifModule=await factory({print:()=>{},printErr:()=>{}});
  const pixels=await decodeHeicPixels(lib,new Uint8Array(await event.data.blob.arrayBuffer()));
  const edge=event.data.maxEdge;if(!Number.isInteger(edge)||edge<1||edge>2048)throw new HeicDecodeError('size');
  const [width,height]=resizeDimensions(pixels.width,pixels.height,edge);
  const data=new ImageData(pixels.data,pixels.width,pixels.height,{colorSpace:pixels.colorSpace});
  if(data.colorSpace!==pixels.colorSpace)throw new HeicDecodeError('color');
  image=await createImageBitmap(data,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});
  self.postMessage({ok:true,image,width:pixels.width,height:pixels.height},{transfer:[image]});image=undefined;
 }catch(error){self.postMessage({ok:false,code:error instanceof HeicDecodeError?error.code:'decode'});}
 finally{image?.close();}
};
