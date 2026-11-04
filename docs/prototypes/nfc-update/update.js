import {fillPlan} from '../photo-fill/geometry.mjs?v=2';
const host=document.querySelector('#reader'),entry=document.querySelector('#entry'),panel=document.querySelector('#panel'),notice=document.querySelector('#notice'),update=document.querySelector('#update');
// Synthetic demo data only. No NFC identifiers, secrets, account data or personal photos.
const grantKey='mori:nfc-update-demo-grant',remoteKey='mori:nfc-update-demo-version';
let mode=new URLSearchParams(location.search).get('mode')==='memory'?'memory':'tab',grant=null,book=null,chapters=[],shown=0,remote=Number(sessionStorage.getItem(remoteKey))||0,expiryTimer,refreshTimer,noticeTimer,busy=false;
try{const saved=JSON.parse(sessionStorage.getItem(grantKey)||'null');if(mode==='tab'&&Number.isFinite(saved?.expiresAt)&&saved.expiresAt>Date.now())grant=saved;else sessionStorage.removeItem(grantKey);}catch{sessionStorage.removeItem(grantKey);}
const caption=v=>v?'함께 웃으며 이야기를 나누던 오후.':'함께 나누던 이야기와 그날의 풍경.';
function toast(text){notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,5000);}
function sync(){
 for(const p of chapters){const box=p.media.parentElement;if(!box)continue;box.style.setProperty('--story-backdrop',`url("${p.src}")`);const plan=fillPlan({width:p.media.naturalWidth,height:p.media.naturalHeight,boxWidth:box.clientWidth||390,boxHeight:box.clientHeight||600,crop:.1});box.classList.toggle('story-portrait',plan.portrait);box.style.setProperty('--story-scale',String(plan.zoom));}
 for(const text of host.querySelectorAll('.story-copy p'))text.textContent=caption(shown);
}
function versions(){document.querySelector('#versions').textContent=`관리에서 수정 ${remote}회 · 현재 표시 ${shown}회 반영`;update.disabled=!grant||busy;}
function end(){grant=null;sessionStorage.removeItem(grantKey);book?.destroy();book=null;chapters=[];entry.hidden=false;document.querySelector('#entry-text').textContent='감상 시간이 끝났거나 새로고침으로 읽기 권한이 사라졌어요. 이 체험에서는 다시 태그해 시작할 수 있어요.';versions();}
async function open(){
 if(!grant||grant.expiresAt<=Date.now()){end();return;}
 book?.destroy();shown=remote;clearTimeout(expiryTimer);expiryTimer=setTimeout(end,grant.expiresAt-Date.now());
 chapters=await Promise.all(Array.from({length:3},async(_,i)=>{const media=new Image();media.alt=`가상 단체사진 ${i+1}`;media.src='../wide-photo/assets/group-synthetic.jpg';await media.decode();return {media,src:media.src,text:caption(shown)};}));
 if(!grant)return;book=window.createMemoryBook(host,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,onTurn:()=>{},onPage:()=>requestAnimationFrame(sync)});entry.hidden=true;sync();versions();
}
function persist(){if(mode==='tab'&&grant)sessionStorage.setItem(grantKey,JSON.stringify(grant));else sessionStorage.removeItem(grantKey);}
document.querySelector('#tag').onclick=()=>{grant={expiresAt:Date.now()+7200000};persist();void open().catch(()=>toast('예시 사진을 불러오지 못했어요. 연결을 확인해 주세요.'));};
for(const radio of document.querySelectorAll('input[name=mode]')){radio.checked=radio.value===mode;radio.onchange=()=>{mode=radio.value;history.replaceState(null,'',`?mode=${mode}`);persist();};}
const show=document.querySelector('#show-tools');show.onclick=()=>{panel.hidden=!panel.hidden;show.setAttribute('aria-expanded',String(!panel.hidden));versions();};
document.querySelector('#edit').onclick=()=>{remote++;sessionStorage.setItem(remoteKey,String(remote));versions();toast('관리에서 글을 수정한 상황이에요. 최신 내용 보기를 눌러 보세요.');};
document.querySelector('#reload').onclick=()=>location.reload();
update.onclick=()=>{
 if(!grant||busy)return;if(grant.expiresAt<=Date.now()){end();return;}
 busy=true;versions();update.textContent='변경 내용을 확인하고 있어요…';
 refreshTimer=setTimeout(()=>{busy=false;update.textContent='최신 내용 보기';if(!grant||grant.expiresAt<=Date.now()){end();return;}if(document.querySelector('#fail').checked)toast('불러오지 못했어요. 지금 보던 내용으로 계속 감상할 수 있어요.');else{shown=remote;for(const p of chapters)p.text=caption(shown);sync();panel.hidden=true;show.setAttribute('aria-expanded','false');toast('최신 내용을 불러왔어요.');}versions();},700);
};
addEventListener('pagehide',()=>{clearTimeout(refreshTimer);clearTimeout(expiryTimer);clearTimeout(noticeTimer);book?.destroy();});
addEventListener('load',()=>{if(grant)void open().catch(()=>toast('예시 사진을 불러오지 못했어요.'));else{if(mode==='memory')document.querySelector('#entry-text').textContent='이 방식은 새로고침하면 다시 NFC를 태그해야 합니다. 실제 NFC와는 연결되지 않은 체험입니다.';versions();}},{once:true});
