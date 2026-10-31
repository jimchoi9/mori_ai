const invalid=()=>new Error('Unsupported HEIC color profile');
const srgb=[.436075,.222505,.013932,.385065,.716879,.097105,.143080,.060617,.714173];
const p3=[.515102,.241182,-.001049,.291965,.692236,.041881,.157153,.066581,.784378];

/** Recognize standard SDR matrix/TRC profiles; never label arbitrary ICC pixels as sRGB. */
export function heicIccColorSpace(bytes:Uint8Array):PredefinedColorSpace {
 try{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const text=(p:number,n=4)=>String.fromCharCode(...bytes.subarray(p,p+n));
  const fixed=(p:number)=>view.getInt32(p)/65536;
  if(bytes.length<132||view.getUint32(0)!==bytes.length||text(16)!=='RGB '||text(20)!=='XYZ '||text(36)!=='acsp')throw invalid();
  const count=view.getUint32(128),tags=new Map<string,[number,number]>();
  if(count>128||132+count*12>bytes.length)throw invalid();
  for(let i=0;i<count;i++){
   const p=132+i*12,name=text(p),offset=view.getUint32(p+4),length=view.getUint32(p+8);
   if(tags.has(name)||offset<132+count*12||length<8||offset+length>bytes.length)throw invalid();
   tags.set(name,[offset,length]);
  }
  if([...tags.keys()].some(name=>/^(?:A2B|B2A|D2B|B2D)\d$/.test(name)||name==='vcgt'))throw invalid();
  const tag=(name:string)=>{const value=tags.get(name);if(!value)throw invalid();return value;};
  for(const name of ['rTRC','gTRC','bTRC']){
   const [offset,length]=tag(name),kind=text(offset);
   if(kind==='para'){
    const type=view.getUint16(offset+8),expected=[2.4,1/1.055,.055/1.055,1/12.92,.04045,...(type===4?[0,0]:[])];
    if(![3,4].includes(type)||length<12+expected.length*4||expected.some((v,i)=>Math.abs(fixed(offset+12+i*4)-v)>.0003))throw invalid();
   }else if(kind==='curv'){
    const n=view.getUint32(offset+8);if(n<256||n>4096||12+n*2>length)throw invalid();
    for(let i=0;i<n;i++){
     const x=i/(n-1),expected=x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
     if(Math.abs(view.getUint16(offset+12+i*2)/65535-expected)>.002)throw invalid();
    }
   }else throw invalid();
  }
  const xyz=(name:string)=>{const [p,n]=tag(name);if(n<20||text(p)!=='XYZ ')throw invalid();return [fixed(p+8),fixed(p+12),fixed(p+16)];};
  if(xyz('wtpt').some((v,i)=>Math.abs(v-[.9642,1,.8249][i])>.002))throw invalid();
  const matrix=['rXYZ','gXYZ','bXYZ'].flatMap(xyz);
  if(matrix.every((v,i)=>Math.abs(v-srgb[i])<.001))return 'srgb';
  if(matrix.every((v,i)=>Math.abs(v-p3[i])<.001))return 'display-p3';
  throw invalid();
 }catch{throw invalid();}
}
