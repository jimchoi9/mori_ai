const experience=document.querySelector('.nfc-experience'),host=document.querySelector('#reader'),error=document.querySelector('#error');
let activeBook=null,chapters=[],sourceUrl=null,loadId=0,width=0,height=0,resizeTimer;
function release(){activeBook?.destroy();activeBook=null;if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=null;chapters=[];}
function nearby(index){chapters.forEach((p,i)=>{if(Math.abs(i-index)<=1){if(!p.media.getAttribute('src'))p.media.src=p.src;p.media.parentElement?.style.setProperty('--story-backdrop',`url("${p.src}")`);}else{p.media.removeAttribute('src');p.media.parentElement?.style.removeProperty('--story-backdrop');}});}
function explain(){
 if(!width||!height)return;
 document.querySelector('#dimensions').textContent=`사진 표시 크기: ${width} × ${height} · ${width<height?'세로':'가로'} 사진`;
 const box=host.querySelector('.story-picture');if(!box)return;const r=box.getBoundingClientRect();if(!r.width||!r.height)return;
 const contain=Math.min(r.width/width,r.height/height),cover=Math.max(r.width/width,r.height/height),w=width*contain,h=height*contain,vertical=Math.max(0,r.height-h),horizontal=Math.max(0,r.width-w);
 const padding=vertical>horizontal?`위아래에 각각 약 ${Math.round(vertical/2)}px`:`좌우에 각각 약 ${Math.round(horizontal/2)}px`;
 document.querySelector('#difference').textContent=`지금 화면에서는 변경안 사진이 기존 대비 약 ${Math.round(contain/cover*100)}% 크기로 보이고, ${padding} 여백이 생깁니다.`;
}
async function load(src,isObjectUrl){
 const token=++loadId,media=new Image();let owned=isObjectUrl;error.hidden=true;
 try{
  media.src=src;await media.decode();if(token!==loadId)return;
  release();sourceUrl=isObjectUrl?src:null;owned=false;width=media.naturalWidth;height=media.naturalHeight;
  chapters=Array.from({length:3},(_,i)=>({media:i===0?media:new Image(),src,text:['함께 나누던 이야기와 그날의 풍경.','같은 사진으로 책 넘김을 확인해 보세요.','사진 전체와 기존 크기를 비교합니다.'][i]}));
  chapters.forEach((p,i)=>{p.media.alt=`선택한 사진 · 비교용 ${i+1}페이지`;});
  activeBook=window.createMemoryBook(host,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,onTurn:nearby,onPage:index=>{nearby(index);requestAnimationFrame(explain);}});
  document.querySelector('#choose').hidden=true;document.querySelector('#controls').hidden=false;explain();
 }catch{if(token===loadId){error.hidden=false;error.textContent='이 사진을 읽지 못했어요. JPG 또는 PNG 사진을 선택해 주세요.';}}
 finally{if(owned)URL.revokeObjectURL(src);}
}
for(const id of ['photo-input','replace-input'])document.getElementById(id).addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void load(URL.createObjectURL(file),true);});
document.querySelectorAll('[data-mode][aria-pressed]').forEach(button=>button.onclick=()=>{experience.dataset.mode=button.dataset.mode;document.querySelectorAll('[data-mode][aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));explain();});
const info=document.querySelector('#info'),toggle=document.querySelector('#info-toggle');toggle.onclick=()=>{info.hidden=!info.hidden;toggle.setAttribute('aria-expanded',String(!info.hidden));explain();};
addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(explain,180);});
addEventListener('pagehide',()=>{loadId++;clearTimeout(resizeTimer);release();},{once:true});
// Only the loopback-only copy contains this sample. The Wi-Fi page always starts with the local file picker.
if(['127.0.0.1','localhost'].includes(location.hostname)&&new URLSearchParams(location.search).get('sample')==='local')void load('portrait-local.jpg',false);
