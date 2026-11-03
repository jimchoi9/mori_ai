import {optimizePhoto} from '../../src/features/uploads/optimizePhoto';
import type {PreparedFile} from '../../src/features/uploads/preprocess';

const pick=document.querySelector<HTMLButtonElement>('#pick')!,run=document.querySelector<HTMLButtonElement>('#run')!;
const input=document.querySelector<HTMLInputElement>('#files')!,status=document.querySelector<HTMLElement>('#status')!,list=document.querySelector<HTMLElement>('#photos')!;
let selected:{prepared:PreparedFile;name:string;url:string}[]=[],used=false;
function message(text:string){status.textContent=text;}
function render(){
 list.replaceChildren();
 for(const [i,item] of selected.entries()){
  const row=document.createElement('article'),img=document.createElement('img'),body=document.createElement('div');
  img.src=item.url;img.alt=`선택한 사진 ${i+1}`;
  const name=document.createElement('p');name.className='filename';name.textContent=item.name;
  const meta=document.createElement('p');meta.className='meta';
  const hint=item.prepared.preprocessing;
  meta.textContent=[hint?.gps?'위치 정보 있음':'위치 정보 없음',hint?.captured_at_raw?'촬영시간 있음':'촬영시간 없음'].join(' · ');
  const caption=document.createElement('p');caption.className='caption';caption.id=`caption-${i}`;
  body.append(name,meta,caption);row.append(img,body);list.append(row);
 }
}
async function request(path:string,body:unknown,authorization?:string){
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:`Bearer ${authorization}`}:{})},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.message??data.detail??'시험 환경에 연결하지 못했어요.');return data;
}
function results(data:any){
 if(!selected.length){
  list.replaceChildren();
  const seen=new Set<number>();
  for(const row of data.results??[]){
   if(seen.has(row.index))continue;seen.add(row.index);
   const card=document.createElement('article'),body=document.createElement('div');card.style.display='block';
   const label=document.createElement('p');label.className='meta';label.textContent=`사진 ${row.index+1} · ${row.gps_present?'위치 정보 있음':'위치 정보 없음'}`;
   const text=document.createElement('p');text.className='caption';text.id=`caption-${row.index}`;
   body.append(label,text);card.append(body);list.append(card);
  }
 }
 const cleared=new Set<number>();
 for(const row of data.results??[]){
  const target=document.querySelector<HTMLElement>(`#caption-${row.index}`);
  if(target){
   if(!cleared.has(row.index)){target.replaceChildren();cleared.add(row.index);}
   if(row.before_caption){
    const before=document.createElement('span');before.className='meta';before.style.display='block';before.textContent=`이전: ${row.before_caption}`;
    target.append(before,document.createTextNode('새 글: '));
   }
   const line=document.createElement('span');line.style.display='block';
   line.textContent=(row.repeat?`시험 ${row.repeat}: `:'')+(row.caption??'글귀를 확인하지 못했어요.');target.append(line);
  }
 }
 used=data.status!=='unused';
 message(data.status==='completed'?'완료됐어요. 실제 장소와 사진 속 행동이 맞는지 확인해 주세요.':data.status==='unused'?'사진 1~2장을 선택해 주세요.':'시험이 중단됐어요. 중복 호출하지 않고 결과를 확인하겠습니다.');
}
pick.addEventListener('click',()=>input.click());
input.addEventListener('change',async()=>{
 const files=Array.from(input.files??[]);input.value='';if(!files.length)return;
 if(files.length>2){message('이번 시험은 사진을 1~2장만 선택해 주세요.');return;}
 pick.disabled=true;run.disabled=true;
 for(const item of selected)URL.revokeObjectURL(item.url);selected=[];render();
 try{
  for(const [index,file] of files.entries()){
   message(`사진을 준비하고 있어요. ${index+1}/${files.length}`);
   const prepared=await optimizePhoto(file,new AbortController().signal);
   selected.push({prepared,name:file.name,url:URL.createObjectURL(prepared.file)});render();
  }
  message(used?'같은 사진을 다시 선택했다면 저장된 시험 결과를 확인할 수 있어요.':'준비됐어요. 글귀 확인을 눌러 주세요.');run.disabled=false;
 }catch(error){message(error instanceof Error?error.message:'사진을 준비하지 못했어요.');}
 finally{pick.disabled=used;}
});
run.addEventListener('click',async()=>{
 pick.disabled=true;run.disabled=true;message('사진을 보고 글귀를 작성하고 있어요.');
 try{
  const photos=[];
  for(const item of selected){
   const bytes=new Uint8Array(await item.prepared.file.arrayBuffer());let text='';
   for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
   photos.push({webp:btoa(text),preprocessing:item.prepared.preprocessing});
  }
  results(await request('/api/trial',{photos}));
 }catch(error){message(error instanceof Error?error.message:'결과를 확인하지 못했어요. 같은 요청은 중복 생성되지 않아요.');run.disabled=false;}
 finally{pick.disabled=used;}
});
const key=new URLSearchParams(location.hash.slice(1)).get('key');
request('/api/session',{},key??undefined).then(data=>{
  history.replaceState(null,'',location.pathname);results(data);
  if(data.experience){
   document.querySelector('h1')!.textContent='장소를 먼저 담은 글 비교';
   document.querySelector('.note')!.textContent='앞서 시험한 두 사진을 같은 순서로 골라 주세요. 이전 글과 새 글을 함께 보여드립니다.';
  }
  if(data.structured){
   document.querySelector('h1')!.textContent='사진만으로 새 글 시험';
   document.querySelector('.note')!.textContent=`사진마다 ${data.repeats}번 독립적으로 글을 만듭니다. 이전 글이나 정답은 AI에 전달하지 않습니다.`;
  }
  if(data.fake)message('연결 점검 모드입니다. 실제 AI를 호출하지 않습니다.');
  pick.disabled=used;
 }).catch(error=>message(error.message));
