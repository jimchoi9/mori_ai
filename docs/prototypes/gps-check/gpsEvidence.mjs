// Local diagnostic only. Never returns coordinates or changes product parsing.
export function inspectJpegGps(bytes) {
 if(bytes[0]!==255||bytes[1]!==216)return 'unsupported';
 try {
  const file=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let p=2;p+4<=bytes.length;) {
   if(bytes[p]!==255)throw Error();
   const marker=bytes[p+1];if(marker===218||marker===217)break;
   const size=file.getUint16(p+2);if(size<2||p+2+size>bytes.length)throw Error();
   if(marker===225&&String.fromCharCode(...bytes.subarray(p+4,p+10))==='Exif\0\0') {
    const data=bytes.subarray(p+10,p+2+size),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
    const endian=String.fromCharCode(...data.subarray(0,2));if(!['II','MM'].includes(endian))throw Error();
    const le=endian==='II',u16=p=>view.getUint16(p,le),u32=p=>view.getUint32(p,le);
    if(u16(2)!==42)throw Error();
    const tags=at=>{
     if(at<8)throw Error();const count=u16(at);if(count>1024||at+2+12*count+4>data.length)throw Error();
     const result=new Map();for(let i=0;i<count;i++){const pos=at+2+12*i,tag=u16(pos);if(result.has(tag))throw Error();result.set(tag,pos);}return result;
    };
    const root=tags(u32(4)),pointer=root.get(34853);if(pointer===undefined)return 'absent';
    if(u16(pointer+2)!==4||u32(pointer+4)!==1)throw Error();
    const gps=tags(u32(pointer+8));
    const refs=[1,3].map(tag=>{
     const pos=gps.get(tag);if(pos===undefined||u16(pos+2)!==2||u32(pos+4)!==2)throw Error();
     return data[pos+8]===0&&data[pos+9]===0;
    });
    const coordinates=[2,4].map(tag=>{
     const pos=gps.get(tag);if(pos===undefined||u16(pos+2)!==5||u32(pos+4)!==3)throw Error();
     const start=u32(pos+8);if(start+24>data.length)throw Error();
     return data.subarray(start,start+24).every(value=>value===0);
    });
    return refs.every(Boolean)&&coordinates.every(Boolean)?'zeroed':'present';
   }
   p+=size+2;
  }
  return 'absent';
 }catch{return 'unreadable';}
}
