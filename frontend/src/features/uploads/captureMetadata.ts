/** Optional capture hints read before pixel conversion; GPS and date fail independently. */
export interface CaptureMetadata {date:string|null;timezone:string|null;gps?:{latitude:number;longitude:number}}
const empty=():CaptureMetadata=>({date:null,timezone:null});
const ascii=(bytes:Uint8Array)=>String.fromCharCode(...bytes);
const invalid=()=>new Error('Invalid capture metadata');
const MAX_METADATA=1_048_576,MAX_ENTRIES=1024;

function tiffDate(bytes:Uint8Array):CaptureMetadata {
 if(bytes.length<8||bytes.length>MAX_METADATA)throw invalid();
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),endian=ascii(bytes.subarray(0,2));
 if(!['II','MM'].includes(endian))throw invalid();
 const le=endian==='II',u16=(p:number)=>view.getUint16(p,le),u32=(p:number)=>view.getUint32(p,le);
 if(u16(2)!==42)throw invalid();
 function entries(at:number):Map<number,number>{
  if(at<8)throw invalid();const n=u16(at);
  if(n>MAX_ENTRIES||at+2+n*12+4>bytes.length)throw invalid();
  const tags=new Map<number,number>();
  for(let i=0;i<n;i++){const p=at+2+i*12,tag=u16(p);tags.set(tag,tags.has(tag)?-1:p);}
  return tags;
 }
 const root=entries(u32(4)),result=empty();
 function pointer(tags:Map<number,number>,tag:number){
  const p=tags.get(tag);if(p===undefined)return;
  if(p<0||u16(p+2)!==4||u32(p+4)!==1||u32(p+8)===u32(4))throw invalid();
  return entries(u32(p+8));
 }
 function string(tags:Map<number,number>,tag:number,size:number){
  const p=tags.get(tag);if(p===undefined)return null;
  if(p<0||u16(p+2)!==2||u32(p+4)!==size)throw invalid();
  const start=size<=4?p+8:u32(p+8);
  if(start+size>bytes.length||bytes[start+size-1]!==0)throw invalid();
  return ascii(bytes.subarray(start,start+size-1));
 }
 try{
  const exif=pointer(root,34665)??root;
  const raw=string(exif,36867,20),match=raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if(match){
   const [year,month,day,hour,minute,second]=match.slice(1).map(Number),date=new Date(0);
   date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
   if(year>=1&&date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day&&hour<=23&&minute<=59&&second<=59){
    result.date=raw;
    try{const zone=string(exif,36881,7);if(zone&&/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(zone))result.timezone=zone;}catch{/* Optional zone. */}
   }
  }
 }catch{/* A broken date does not discard GPS. */}
 try{
  const gps=pointer(root,34853);
  if(gps){
   function coordinate(tag:number,refTag:number,max:number,positive:string,negative:string){
    const p=gps!.get(tag),ref=string(gps!,refTag,2);
    if(p===undefined||p<0||u16(p+2)!==5||u32(p+4)!==3||![positive,negative].includes(ref??''))throw invalid();
    const start=u32(p+8);if(start+24>bytes.length)throw invalid();
    const parts=[0,8,16].map(offset=>{const denominator=u32(start+offset+4);if(!denominator)throw invalid();return u32(start+offset)/denominator;});
    if(parts[0]>max||parts[1]>=60||parts[2]>=60)throw invalid();
    const value=parts[0]+parts[1]/60+parts[2]/3600;if(!Number.isFinite(value)||value>max)throw invalid();
    return Number(((ref===negative?-1:1)*value).toFixed(6));
   }
   result.gps={latitude:coordinate(2,1,90,'N','S'),longitude:coordinate(4,3,180,'E','W')};
  }
 }catch{/* Invalid or incomplete coordinates never reject a valid photo. */}
 return result;
}

interface Box {kind:string;start:number;end:number}
/** ISO BMFF item locations, restricted to unprotected Exif describing the primary image. */
function heifExif(bytes:Uint8Array):Uint8Array|undefined {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let budget=4096;
 const uint=(p:number,n:number,end=bytes.length)=>{
  if(n>8||p+n>end)throw invalid();let value=0;
  for(let i=0;i<n;i++)value=value*256+bytes[p+i];
  if(!Number.isSafeInteger(value))throw invalid();return value;
 };
 function boxes(start:number,end:number):Box[]{
  const out:Box[]=[];
  for(let p=start;p<end;){
   if(--budget<0||p+8>end)throw invalid();
   let size=view.getUint32(p),head=8;
   if(size===1){size=uint(p+8,8,end);head=16;}else if(size===0)size=end-p;
   if(size<head||p+size>end)throw invalid();
   out.push({kind:ascii(bytes.subarray(p+4,p+8)),start:p+head,end:p+size});p+=size;
  }
  return out;
 }
 function one(list:Box[],kind:string){const found=list.filter(b=>b.kind===kind);if(found.length!==1)throw invalid();return found[0];}
 const top=boxes(0,bytes.length),meta=one(top,'meta');
 if(uint(meta.start,4,meta.end)!==0)throw invalid();
 const children=boxes(meta.start+4,meta.end),pitm=one(children,'pitm'),pv=bytes[pitm.start];
 if(pv>1)throw invalid();const primary=uint(pitm.start+4,pv===0?2:4,pitm.end);
 const info=one(children,'iinf'),iv=bytes[info.start];if(iv>1)throw invalid();
 const count=uint(info.start+4,iv===0?2:4,info.end),entries=boxes(info.start+(iv===0?6:8),info.end);
 if(count>MAX_ENTRIES||count!==entries.length)throw invalid();
 const exif=new Set<number>();
 for(const entry of entries){
  if(entry.kind!=='infe')continue;
  const version=bytes[entry.start];if(![2,3].includes(version))continue;
  const size=version===2?2:4,id=uint(entry.start+4,size,entry.end);
  if(entry.start+4+size+6>entry.end)throw invalid();
  if(uint(entry.start+4+size,2,entry.end)===0&&ascii(bytes.subarray(entry.start+6+size,entry.start+10+size))==='Exif'){
   if(exif.has(id))throw invalid();exif.add(id);
  }
 }
 const refs=one(children,'iref'),rv=bytes[refs.start];if(rv>1)throw invalid();
 const candidates=new Set<number>(),idSize=rv===0?2:4;
 for(const ref of boxes(refs.start+4,refs.end)){
  if(ref.kind!=='cdsc')continue;
  const source=uint(ref.start,idSize,ref.end),n=uint(ref.start+idSize,2,ref.end);
  if(n>MAX_ENTRIES||ref.start+idSize+2+n*idSize!==ref.end)throw invalid();
  for(let i=0;i<n;i++)if(exif.has(source)&&uint(ref.start+idSize+2+i*idSize,idSize,ref.end)===primary)candidates.add(source);
 }
 if(candidates.size!==1)return;
 const target=[...candidates][0],loc=one(children,'iloc'),lv=bytes[loc.start];if(lv>2)throw invalid();
 let p=loc.start+4;
 const read=(n:number)=>{const result=uint(p,n,loc.end);p+=n;return result;};
 const sizes=read(1),sizes2=read(1),offsetSize=sizes>>4,lengthSize=sizes&15,baseSize=sizes2>>4,indexSize=lv?sizes2&15:0;
 if([offsetSize,lengthSize,baseSize,indexSize].some(n=>n>8))throw invalid();
 const items=read(lv===2?4:2);if(items>MAX_ENTRIES)throw invalid();
 const extents:Uint8Array[]=[];let total=0,found=false;
 for(let i=0;i<items;i++){
  const id=read(lv===2?4:2),method=lv?read(2):0,reference=read(2),base=read(baseSize),n=read(2);
  if(n>MAX_ENTRIES)throw invalid();
  if(id===target){if(found||reference!==0||method>1)throw invalid();found=true;}
  for(let e=0;e<n;e++){
   read(indexSize);const offset=read(offsetSize),length=read(lengthSize);
   if(id!==target)continue;
   if(!length||total+length>MAX_METADATA)throw invalid();
   const area=method===1?one(children,'idat'):undefined,start=base+offset+(area?.start??0),end=start+length;
   const valid=area?end<=area.end:top.some(b=>b.kind==='mdat'&&start>=b.start&&end<=b.end);
   if(!Number.isSafeInteger(end)||!valid)throw invalid();
   extents.push(bytes.subarray(start,end));total+=length;
  }
 }
 if(p!==loc.end||!found||total<12)throw invalid();
 const data=new Uint8Array(total);let cursor=0;for(const extent of extents){data.set(extent,cursor);cursor+=extent.length;}
 const offset=new DataView(data.buffer).getUint32(0);if(offset+12>data.length)throw invalid();
 return data.subarray(4+offset);
}

/** Read before lossy conversion. Failure drops optional hints, never a valid photo. */
export function readCaptureMetadata(bytes:Uint8Array,mime:string):CaptureMetadata {
 try{
  if(bytes.length>20*1024*1024)return empty();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(mime==='image/heic'||mime==='image/heif'){
   const data=heifExif(bytes);return data?tiffDate(data):empty();
  }
  if(mime==='image/jpeg'){
   if(view.getUint16(0)!==0xffd8)return empty();let p=2,budget=4096;
   while(p+4<=bytes.length&&bytes[p++]===255&&budget-->0){
    while(p<bytes.length&&bytes[p]===255)p++;const marker=bytes[p++];if(marker===218||marker===217)break;
    const n=view.getUint16(p);if(n<2||p+n>bytes.length)throw invalid();
    if(marker===225&&ascii(bytes.subarray(p+2,p+8))==='Exif\0\0')return tiffDate(bytes.subarray(p+8,p+n));p+=n;
   }
  }else if(mime==='image/png'){
   if(ascii(bytes.subarray(0,8))!=='\x89PNG\r\n\x1a\n')return empty();
   let p=8,budget=4096;
   while(p+12<=bytes.length&&budget-->0){
    const n=view.getUint32(p);if(p+n+12>bytes.length)throw invalid();
    if(ascii(bytes.subarray(p+4,p+8))==='eXIf')return tiffDate(bytes.subarray(p+8,p+8+n));p+=n+12;
   }
  }else if(mime==='image/webp'){
   if(ascii(bytes.subarray(0,4))!=='RIFF'||ascii(bytes.subarray(8,12))!=='WEBP'||view.getUint32(4,true)+8!==bytes.length)return empty();
   let p=12,budget=4096;
   while(p+8<=bytes.length&&budget-->0){
    const n=view.getUint32(p+4,true);if(p+8+n>bytes.length)throw invalid();
    if(ascii(bytes.subarray(p,p+4))==='EXIF'){
     const data=bytes.subarray(p+8,p+8+n);return tiffDate(ascii(data.subarray(0,6))==='Exif\0\0'?data.subarray(6):data);
    }
    p+=8+n+(n&1);
   }
  }
 }catch{/* Missing/unsupported metadata uses file.lastModified on the server. */}
 return empty();
}
