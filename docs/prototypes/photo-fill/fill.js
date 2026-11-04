import {fillPlan} from './geometry.mjs?v=2';
const experience=document.querySelector('.nfc-experience'),host=document.querySelector('#reader'),panel=document.querySelector('#panel'),settings=document.querySelector('#settings'),error=document.querySelector('#error');
let activeBook=null,chapters=[],sourceUrl=null,loadId=0,width=0,height=0,resizeTimer,crop=.1;
function release(){activeBook?.destroy();activeBook=null;if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=null;chapters=[];}
function nearby(index){chapters.forEach((p,i)=>{if(Math.abs(i-index)<=1){if(!p.media.getAttribute('src'))p.media.src=p.src;p.media.parentElement?.style.setProperty('--story-backdrop',`url("${p.src}")`);}else{p.media.removeAttribute('src');p.media.parentElement?.style.removeProperty('--story-backdrop');}});}
function refresh(){
 if(!width||!height)return;
 const mode=experience.dataset.mode;experience.classList.toggle('is-portrait',height>=width);document.querySelector('#crop-choice').disabled=mode!=='proposed'||height>=width;
 let plan;
 for(const box of host.querySelectorAll('.story-picture')){
  if(!box.clientWidth||!box.clientHeight)continue;
  plan=fillPlan({width,height,boxWidth:box.clientWidth,boxHeight:box.clientHeight,mode,crop});
  box.style.setProperty('--photo-scale',String(mode==='proposed'&&!plan.portrait?plan.zoom:1));
 }
 document.querySelector('#policy').textContent=mode==='contain'?'이전 변경안: 모든 사진을 자르지 않고 전체를 보여줍니다.':mode==='cover'?'완전 채우기: 빈틈이 없도록 자르기 양에 제한 없이 확대합니다.':height>=width?'새 제안: 세로·정사각형은 빈틈 없이 꽉 채웁니다.':width/height<4/3?'새 제안: 정사각형에 가까울수록 꽉 채우고, 4:3에 가까워질수록 아래 자르기 한도로 부드럽게 전환합니다.':'새 제안: 4:3 이상으로 넓은 사진은 아래 자르기 한도를 적용합니다.';
 if(plan){const loss=Math.max(plan.leftLoss,plan.topLoss)*100,axis=plan.leftLoss>=plan.topLoss?'좌우':'위아래',gap=Math.max(plan.gapY,plan.gapX);document.querySelector('#metrics').textContent=`${width>=height?'가로':'세로'} 사진 · ${axis} 각각 약 ${loss.toFixed(1)}% 잘림${gap>1?` · ${plan.gapY>=plan.gapX?'위아래':'좌우'} 각각 약 ${Math.round(gap/2)}px 여백`:''}`;}
}
async function load(src,isObjectUrl){
 const token=++loadId,media=new Image();let owned=isObjectUrl;error.hidden=true;
 try{
  media.src=src;await media.decode();if(token!==loadId)return;
  release();sourceUrl=isObjectUrl?src:null;owned=false;width=media.naturalWidth;height=media.naturalHeight;
  chapters=Array.from({length:3},(_,i)=>({media:i===0?media:new Image(),src,text:['함께 나누던 이야기와 그날의 풍경.','사진 크기와 잘리는 부분을 비교해 보세요.','같은 사진으로 책 넘김을 확인합니다.'][i]}));
  chapters.forEach((p,i)=>{p.media.alt=`비교 사진 ${i+1}`;});
  activeBook=window.createMemoryBook(host,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,onTurn:nearby,onPage:index=>{nearby(index);requestAnimationFrame(refresh);}});refresh();
 }catch{if(token===loadId){error.hidden=false;error.textContent='사진을 읽지 못했어요. JPG 또는 PNG 사진을 선택해 주세요.';}}
 finally{if(owned)URL.revokeObjectURL(src);}
}
document.querySelector('#photo-input').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';if(file)void load(URL.createObjectURL(file),true);});
document.querySelector('#sample').onclick=()=>void load('sample.jpg',false);
document.querySelectorAll('[data-mode][aria-pressed]').forEach(button=>button.onclick=()=>{experience.dataset.mode=button.dataset.mode;document.querySelectorAll('[data-mode][aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refresh();});
document.querySelectorAll('[data-crop]').forEach(button=>button.onclick=()=>{crop=Number(button.dataset.crop);document.querySelectorAll('[data-crop]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refresh();});
settings.onclick=()=>{panel.hidden=!panel.hidden;settings.setAttribute('aria-expanded',String(!panel.hidden));refresh();};
document.querySelector('#hide-settings').onclick=()=>{panel.hidden=true;settings.setAttribute('aria-expanded','false');settings.focus({preventScroll:true});};
addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(refresh,180);});
addEventListener('pagehide',()=>{loadId++;clearTimeout(resizeTimer);release();},{once:true});
addEventListener('load',()=>void load('sample.jpg',false),{once:true});
