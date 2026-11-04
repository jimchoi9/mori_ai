import {readCaptureMetadata} from './captureMetadata.js';
import {inspectJpegGps} from './gpsEvidence.mjs';
const values={},$=id=>document.getElementById(id);
const text=(tag,value,cls='')=>{const e=document.createElement(tag);e.textContent=value;e.className=cls;return e;};
// Comparison checksum only; never a credential or security guarantee.
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function checksum(bytes){let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return ((n^0xffffffff)>>>0).toString(16).padStart(8,'0');}
function compare(){
 const section=$('verdict');section.replaceChildren(text('h2','비교 결과'));
 const a=values.photo,b=values.file;
 if(!a||!b){section.append(text('p','두 방식을 모두 확인하면 결과가 나옵니다.'));return;}
 if(a.name!==b.name)section.append(text('p','이름이 달라도 선택 경로가 붙인 표시 이름일 수 있습니다. 같은 사진을 골랐다는 전제로 아래 결과를 비교합니다.'));
 let message;
 if(!a.gps&&b.gps)message='같은 사진이라면, 기존 사진 선택에서는 GPS가 제외되고 파일 선택에서는 전달되는 것을 확인했습니다.';
 else if(a.gps&&!b.gps)message='같은 사진이라면, 기존 사진 선택에서는 GPS가 전달되고 파일 선택에서는 유효한 GPS를 읽지 못했습니다.';
 else if(a.gps)message='이 사진은 기존 사진 선택으로도 유효한 GPS가 전달됩니다. 실제 ‘공간에서’가 나온 사진과 같은 사진인지 확인해 주세요.';
 else message='두 경로 모두 유효한 GPS를 읽지 못했습니다. 기기 원본부터 없었는지, 두 경로에서 모두 제외됐는지 원본 대조가 더 필요합니다.';
 section.append(text('p',message),text('p',a.checksum===b.checksum&&a.size===b.size?'두 선택의 파일 비교값과 크기가 같습니다.':'두 선택의 파일 비교값 또는 크기가 다릅니다. 파일 내용이 달라졌을 수 있습니다.','file-details'));
}
for(const mode of ['photo','file']){
 let attempt=0;
 $(mode).addEventListener('change',async event=>{
  const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
  const current=++attempt,out=$(mode+'-result');delete values[mode];out.replaceChildren(text('p','사진의 위치 정보만 확인하고 있어요.'));compare();
  try{
   if(selected.size>20*1024*1024)throw Error('20MiB 이하의 사진 한 장으로 확인해 주세요.');
   const bytes=new Uint8Array(await selected.arrayBuffer());if(current!==attempt)return;
   const ascii=(a,b)=>String.fromCharCode(...bytes.subarray(a,b));
   const mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes[0]===137&&bytes[1]===80?'image/png':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'image/webp':ascii(4,8)==='ftyp'?'image/heic':'';
   if(!mime)throw Error('JPEG·PNG·WebP·HEIC 사진을 골라주세요.');
   const info=readCaptureMetadata(bytes,mime),value={name:selected.name,size:selected.size,checksum:checksum(bytes),gps:!!info.gps,date:!!info.date};values[mode]=value;
   const evidence=inspectJpegGps(bytes),evidenceText={zeroed:'GPS 항목은 있지만 방향 문자와 좌표 데이터가 모두 0입니다. 위치 정보를 가리는 처리와 일치하는 형태입니다.',present:'GPS 항목과 0이 아닌 데이터가 있습니다. 유효한 좌표인지는 위 결과로 확인합니다.',absent:'JPEG에서 EXIF GPS 항목을 찾지 못했습니다.',unreadable:'JPEG GPS 항목의 구조를 확인할 수 없습니다.',unsupported:'GPS의 0 채움 검사는 JPEG만 지원합니다.'}[evidence];
   const result=text('p','','result-line'+(value.gps?'':' missing'));result.append(text('strong',value.gps?'유효한 GPS가 도착했어요':'유효한 GPS를 읽지 못했어요'),text('span',value.date?'촬영일은 읽었습니다.':'촬영일도 읽지 못했습니다.'));
   out.replaceChildren(result,text('p',evidenceText,'file-details'),text('p',value.name,'file-details'),text('p',value.size.toLocaleString()+' bytes · 파일 비교값 '+value.checksum,'file-details'));compare();
  }catch(error){if(current===attempt){out.replaceChildren(text('p',error.message,'error'));compare();}}
 });
}
