const experience=document.querySelector('.nfc-experience'),host=document.querySelector('#reader');
experience.classList.add('demo-blur');
let activeBook=null;
async function start(){
 try{
  const chapters=await Promise.all(Array.from({length:3},async(_,index)=>{const media=new Image();media.alt=`함께 앉아 있는 네 사람 · 비교용 ${index+1}페이지`;media.src='../assets/group-synthetic.jpg';await media.decode();return {media,src:media.src,text:['함께 앉아 나누던 한낮의 시간.','같은 사진으로 책 넘김을 확인해 보세요.','사진 전체가 담기는 배치를 비교합니다.'][index]};}));
  activeBook=window.createMemoryBook(host,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,onTurn:()=>{},onPage:()=>{}});
  // The existing HTML-page reader owns navigation. This only decorates its photo slots.
  for(const chapter of chapters)chapter.media.parentElement.style.setProperty('--story-backdrop',`url("${chapter.src}")`);
  // The reader rebuilds page DOM after orientation or viewport changes. Reapply on the new slots.
  const observer=new MutationObserver(()=>{for(const picture of host.querySelectorAll('.story-picture')){if(!picture.style.getPropertyValue('--story-backdrop')){const src=picture.querySelector('img')?.src;if(src)picture.style.setProperty('--story-backdrop',`url("${src}")`);}}});
  observer.observe(host,{childList:true,subtree:true});
  addEventListener('pagehide',()=>{observer.disconnect();activeBook?.destroy();activeBook=null;},{once:true});
 }catch{const error=document.querySelector('#error');error.hidden=false;error.textContent='체험 사진이나 책을 불러오지 못했어요. 연결을 확인한 뒤 다시 열어 주세요.';}
}
const tools=document.querySelector('#tools'),toggle=document.querySelector('#show-tools');
toggle.onclick=()=>{tools.hidden=!tools.hidden;toggle.setAttribute('aria-expanded',String(!tools.hidden));};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{experience.classList.toggle('demo-blur',button.dataset.mode==='blur');document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
void start();
