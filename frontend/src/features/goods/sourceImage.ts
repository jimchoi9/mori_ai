/** Original-container checks that must happen before browser conversion strips metadata. */
const text=(b:Uint8Array)=>String.fromCharCode(...b);
const unsupported=()=>new Error('JPEG·PNG·WebP·HEIC 사진 1장을 선택해 주세요.');
export function inspectGoodsSource(bytes:Uint8Array):{mime:string;width?:number;height?:number}{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes[0]===255&&bytes[1]===216)return {mime:'image/jpeg'};
 if(text(bytes.subarray(0,8))==='\x89PNG\r\n\x1a\n'){
  let p=8,width=0,height=0,ended=false;
  while(p+12<=bytes.length){
   const n=view.getUint32(p),kind=text(bytes.subarray(p+4,p+8)),body=p+8;
   if(n>bytes.length-body-4)throw unsupported();
   if(kind==='IHDR'){
    if(p!==8||n!==13)throw unsupported();
    width=view.getUint32(body);height=view.getUint32(body+4);
    if(bytes[body+8]>8)throw new Error('이 사진의 색상 형식을 처리하지 못했어요.');
   }
   if(kind==='acTL')throw new Error('움직이는 사진은 첨부할 수 없어요.');
   if(kind==='cICP'&&(n!==4||[16,18].includes(bytes[body+1])))throw new Error('이 사진의 색상 형식을 처리하지 못했어요.');
   p+=n+12;
   if(kind==='IEND'){ended=n===0&&p===bytes.length;break;}
  }
  if(!width||!height||!ended)throw unsupported();
  return {mime:'image/png',width,height};
 }
 if(text(bytes.subarray(0,4))==='RIFF'&&text(bytes.subarray(8,12))==='WEBP'){
  if(bytes.length<20||view.getUint32(4,true)+8!==bytes.length)throw unsupported();
  let p=12,width=0,height=0;
  while(p+8<=bytes.length){
   const kind=text(bytes.subarray(p,p+4)),n=view.getUint32(p+4,true),body=p+8;
   if(n>bytes.length-body)throw unsupported();
   if(kind==='ANIM'||kind==='ANMF'||kind==='VP8X'&&n>=10&&(bytes[body]&2))throw new Error('움직이는 사진은 첨부할 수 없어요.');
   if(kind==='VP8X'&&n===10){width=1+bytes[body+4]+(bytes[body+5]<<8)+(bytes[body+6]<<16);height=1+bytes[body+7]+(bytes[body+8]<<8)+(bytes[body+9]<<16);}
   if(kind==='VP8 '&&n>=10){width=view.getUint16(body+6,true)&16383;height=view.getUint16(body+8,true)&16383;}
   if(kind==='VP8L'&&n>=5&&bytes[body]===47){const bits=view.getUint32(body+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
   p+=8+n+(n%2);
  }
  if(p!==bytes.length||!width||!height)throw unsupported();
  return {mime:'image/webp',width,height};
 }
 if(bytes.length>=16&&text(bytes.subarray(4,8))==='ftyp'){
  const length=view.getUint32(0),brands=[text(bytes.subarray(8,12))];
  if(length<16||length>bytes.length)throw unsupported();
  for(let p=16;p+4<=length;p+=4)brands.push(text(bytes.subarray(p,p+4)));
  if(brands.some(b=>['avif','avis'].includes(b)))throw unsupported();
  if(brands.some(b=>['heic','heix','hevc','hevx','heim','heis','hevm','hevs','mif1','msf1'].includes(b)))return {mime:'image/heic'};
 }
 throw unsupported();
}
