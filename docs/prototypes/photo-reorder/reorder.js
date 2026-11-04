import {art} from './art.js';
import {insertAt,slotAt,scrollDelta,restoreManual} from './order.mjs';
import {createHold} from './hold.mjs?v=2';
const $=s=>document.querySelector(s),list=$('#rows');
const titles=['바다 산책','초록 능선','오후의 카페','노을 바다','느린 오후','숲속 산책'];
const captions=['바닷가를 따라 천천히 걸었던 오후.','초록빛 산을 바라보며 잠시 쉬었다.','창가에 앉아 함께 마신 따뜻한 커피.','해 질 무렵 다시 찾은 바다.','나란히 앉아 이야기를 나눈 시간.','산책길에서 만난 푸른 풍경.'];
let photos=[],order=[],manual=[],mode='hold',sort='date',editing=false,edited=false,busy=false,menu=null,pending=null,active=null,frame=0,saveTimer,toastTimer,swallow=null,serial=0;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grip='<svg width="18" height="24" viewBox="0 0 18 24" aria-hidden="true">'+[5,12,19].flatMap(y=>[5,13].map(x=>`<circle cx="${x}" cy="${y}" r="1.5" fill="currentColor"/>`)).join('')+'</svg>';
const photo=id=>photos.find(p=>p.id===id);
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function dismissToast(){clearTimeout(toastTimer);$('#toast').hidden=true;}
function ui(){
 document.body.classList.toggle('editing',editing);$('#count').textContent=`${photos.length} / 50`;$('#sort').value=sort;
 $('#save-state').textContent=busy?'순서 저장 중…':editing?(edited?'변경사항 저장됨':'변경사항 없음'):`사진 ${photos.length}장 저장됨`;
 $('#edit').innerHTML=editing?(edited?'저장하고 완료':'완료'):'<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m4 16-1 5 5-1L20 8l-4-4Z M14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>편집';
 $('#help').textContent=mode==='hold'?'사진을 길게 눌러 원하는 자리에 놓아보세요.':'편집을 누른 뒤 오른쪽 손잡이로 옮겨보세요.';
 for(const element of document.querySelectorAll('#settings-panel button,#settings-panel input,#sort,#edit,#add'))element.disabled=busy||!!active;
 $('#add').disabled=busy||!!active||photos.length>=50;
}
function render(){
 list.innerHTML=order.map((id,i)=>{const p=photo(id);return `<li class="photo-row${editing?' has-handle':''}" data-id="${id}"><button type="button" class="thumb" data-open aria-label="${escape(p.title)} 사진 확인"><img src="${p.src}" alt="" draggable="false"><span class="number">${i+1}</span></button><div class="caption"><strong>${escape(p.title)}</strong>${editing?`<textarea aria-label="${i+1}번째 사진 글귀" maxlength="80">${escape(p.caption)}</textarea>`:`<p>${escape(p.caption)}</p>`}</div>${editing?`<button type="button" class="handle" data-handle aria-label="${escape(p.title)} 순서 변경" aria-describedby="drag-help">${grip}<span>순서</span></button>`:''}${menu===id?`<div class="move-menu"><button type="button" data-move="first" ${i===0?'disabled':''}>맨 앞으로</button><button type="button" data-move="up" ${i===0?'disabled':''}>한 칸 위로</button><button type="button" data-move="down" ${i===order.length-1?'disabled':''}>한 칸 아래로</button><button type="button" data-move="last" ${i===order.length-1?'disabled':''}>맨 뒤로</button></div>`:''}</li>`;}).join('');ui();
}
function initialise(count=6){cancel();photos=[];order=[];sort='date';serial=0;for(let i=0;i<count;i++)addSample(false);order=photos.map(p=>p.id);manual=[];sort='date';editing=false;edited=false;menu=null;render();}
function addSample(show=true){const n=serial++,p={id:'p'+n,title:titles[n%6]+(n>=6?` ${Math.floor(n/6)+1}`:''),caption:captions[n%6],src:art(n)};photos.push(p);order.push(p.id);if(sort==='manual')manual=[...order];if(show){render();toast('예시 사진을 한 장 추가했어요.');}}
function clearPending(){pending?.hold?.cancel();pending=null;}
function source(event){
 const row=event.target.closest('li[data-id]');if(!row||row.parentElement!==list)return null;
 if(event.target.closest('[data-handle]'))return {row,handle:true};
 if(mode!=='hold'||event.target.closest('textarea,input,select,[data-move]'))return null;
 const button=event.target.closest('button');if(button&&!button.matches('[data-open]'))return null;
 return {row,handle:false};
}
function arm(info,point,kind,pointer){
 if(active||pending)return;
 dismissToast();
 pending={...info,x:point.x,y:point.y,lastY:point.y,kind,pointer,hold:null,moved:false,scrollY:window.scrollY};
 if(!info.handle){const press=pending;press.hold=createHold({blocked:()=>busy,activate:()=>{if(pending===press)lift();}});}
}
function lift(){
 if(!pending||busy)return;const p=pending;clearPending();menu=null;
 const rect=p.row.getBoundingClientRect(),placeholder=document.createElement('li');placeholder.className='photo-row is-placeholder';placeholder.style.height=rect.height+'px';placeholder.setAttribute('aria-hidden','true');
 list.insertBefore(placeholder,p.row);p.row.classList.add('floating');Object.assign(p.row.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
 active={...p,id:p.row.dataset.id,placeholder,offsetY:p.y-rect.top,y:p.lastY,slot:order.indexOf(p.row.dataset.id),lastTime:0,viewportWidth:innerWidth};
 document.body.classList.add('dragging');ui();updateSlot();frame=requestAnimationFrame(tick);
}
function remaining(){return [...list.children].filter(row=>row!==active.row&&row!==active.placeholder);}
function nextFlow(node){let next=node.nextElementSibling;while(next===active.row)next=next.nextElementSibling;return next;}
function updateSlot(){
 if(!active)return;const others=remaining(),top=list.getBoundingClientRect().top;
 const slot=slotAt(others.map(row=>top+row.offsetTop+row.offsetHeight/2),active.y),before=others[slot]??null;
 if(nextFlow(active.placeholder)!==before){
  const positions=new Map(others.map(row=>[row,row.offsetTop]));list.insertBefore(active.placeholder,before);
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const row of others){const delta=positions.get(row)-row.offsetTop;if(delta&&row.animate){for(const animation of row.getAnimations())animation.cancel();row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:160,easing:'ease-out'});}}
 }
 active.slot=slot;active.placeholder.dataset.slot=`${slot+1}번째 자리 · 여기에 놓기`;
 const beforeName=others[slot-1]?photo(others[slot-1].dataset.id).title:null,afterName=others[slot]?photo(others[slot].dataset.id).title:null;
 const announcement=`${photo(active.id).title}, ${beforeName&&afterName?`${beforeName}와 ${afterName} 사이`:beforeName?`${beforeName} 다음`:afterName?`${afterName} 앞`:'첫 번째 자리'}`;if($('#announcement').textContent!==announcement)$('#announcement').textContent=announcement;
}
function tick(time){
 if(!active)return;const elapsed=Math.min(32,active.lastTime?time-active.lastTime:16);active.lastTime=time;
 const bottom=innerHeight-$('#footer').getBoundingClientRect().height,delta=scrollDelta(active.y,55,bottom)*elapsed/16;
 if(delta){const max=Math.max(0,document.documentElement.scrollHeight-innerHeight);window.scrollTo(0,Math.max(0,Math.min(max,window.scrollY+delta)));}
 active.row.style.top=(active.y-active.offsetY-6)+'px';updateSlot();frame=requestAnimationFrame(tick);
}
function pointMove(point){
 if(active){active.y=point.y;return;}
 if(!pending)return;pending.lastY=point.y;const distance=Math.hypot(point.x-pending.x,point.y-pending.y);
 if(pending.handle&&distance>5){pending.moved=true;lift();}else if(!pending.handle&&distance>10)clearPending();
}
function cancel(){
 clearPending();if(!active)return;cancelAnimationFrame(frame);active=null;document.body.classList.remove('dragging');render();
}
function save(next,message,nextSort='manual',focusId=null){
 if(busy||next.length!==order.length)return;
 const before=[...order],oldSort=sort,oldManual=[...manual];order=[...next];sort=nextSort;menu=null;busy=true;render();
 saveTimer=setTimeout(()=>{
  busy=false;
  if($('#fail').checked){clearPending();order=before;sort=oldSort;manual=oldManual;render();if(focusId)list.querySelector(`[data-id="${focusId}"] [data-handle]`)?.focus({preventScroll:true});toast('저장하지 못해 이전 순서로 되돌렸어요.');return;}
  if(sort==='manual')manual=[...order];if(editing)edited=true;
  // The optimistic order is already rendered. Keep these exact rows alive for the next press.
  ui();
  if(focusId&&!pending)list.querySelector(`[data-id="${focusId}"] [data-handle]`)?.focus({preventScroll:true});
  if(!pending)toast(message);
  if(pending?.handle&&pending.moved)lift();else pending?.hold?.resume();
 },600);
}
function drop(){
 clearPending();if(!active)return;const current=active;cancelAnimationFrame(frame);active=null;document.body.classList.remove('dragging');swallow={id:current.id,until:performance.now()+700};
 const next=insertAt(order,current.id,current.slot);if(next.every((id,i)=>id===order[i])){render();return;}
 save(next,`${photo(current.id).title}을 ${current.slot+1}번째로 옮겼어요.`);
}
list.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'||event.button!==0)return;const info=source(event);if(info)arm(info,{x:event.clientX,y:event.clientY},'pointer',event.pointerId);});
window.addEventListener('pointermove',event=>{if((active??pending)?.kind==='pointer'&&(active??pending).pointer===event.pointerId)pointMove({x:event.clientX,y:event.clientY});});
window.addEventListener('pointerup',event=>{if((active??pending)?.kind!=='pointer'||(active??pending).pointer!==event.pointerId)return;if(active)drop();else clearPending();});
window.addEventListener('pointercancel',event=>{if((active??pending)?.kind==='pointer'&&(active??pending).pointer===event.pointerId)cancel();});
list.addEventListener('touchstart',event=>{if(event.touches.length!==1){cancel();return;}const info=source(event);if(!info)return;const t=event.changedTouches[0];if(info.handle)event.preventDefault();arm(info,{x:t.clientX,y:t.clientY},'touch',t.identifier);},{passive:false});
list.addEventListener('touchmove',event=>{const g=active??pending;if(g?.kind!=='touch')return;const t=[...event.touches].find(t=>t.identifier===g.pointer);if(!t)return;if(active||g.handle)event.preventDefault();pointMove({x:t.clientX,y:t.clientY});},{passive:false});
list.addEventListener('touchend',event=>{const g=active??pending;if(g?.kind!=='touch'||![...event.changedTouches].some(t=>t.identifier===g.pointer))return;if(active){event.preventDefault();drop();}else{const handle=g.handle,id=g.row.dataset.id;clearPending();if(handle){event.preventDefault();if(!busy){swallow={id,until:performance.now()+700};menu=menu===id?null:id;render();}}}},{passive:false});
list.addEventListener('touchcancel',()=>{if((active??pending)?.kind==='touch')cancel();});
window.addEventListener('touchstart',event=>{if(event.touches.length>1)cancel();},{passive:true});
window.addEventListener('scroll',()=>{if(pending&&!pending.handle&&Math.abs(window.scrollY-pending.scrollY)>3)clearPending();},{passive:true});
window.addEventListener('resize',()=>{if(active&&Math.abs(innerWidth-active.viewportWidth)>4)cancel();});
window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
list.addEventListener('contextmenu',event=>{if(!event.target.closest('textarea'))event.preventDefault();});
list.addEventListener('click',event=>{
 const row=event.target.closest('li[data-id]');if(!row)return;const id=row.dataset.id;
 if(swallow&&performance.now()<swallow.until&&swallow.id===id&&event.target.closest('.thumb,.handle')){event.preventDefault();event.stopPropagation();swallow=null;return;}
 if(busy||active)return;
 if(event.target.closest('[data-handle]')){menu=menu===id?null:id;render();return;}
 const move=event.target.closest('[data-move]');if(move){const index=order.indexOf(id),slot=move.dataset.move==='first'?0:move.dataset.move==='last'?order.length-1:index+(move.dataset.move==='up'?-1:1);save(insertAt(order,id,slot),`${photo(id).title}을 ${slot+1}번째로 옮겼어요.`,'manual',id);return;}
 if(event.target.closest('[data-open]')&&!editing){const p=photo(id);$('#preview-image').src=p.src;$('#preview-image').alt=p.title;$('#preview-caption').textContent=p.caption;$('#preview').showModal();}
},true);
list.addEventListener('keydown',event=>{if(!event.target.closest('[data-handle]')||!['ArrowUp','ArrowDown'].includes(event.key)||busy)return;event.preventDefault();const id=event.target.closest('li[data-id]').dataset.id,index=order.indexOf(id),slot=index+(event.key==='ArrowUp'?-1:1);if(slot>=0&&slot<order.length)save(insertAt(order,id,slot),`${photo(id).title}을 ${slot+1}번째로 옮겼어요.`,'manual',id);});
list.addEventListener('input',event=>{if(event.target.matches('textarea')){photo(event.target.closest('li[data-id]').dataset.id).caption=event.target.value;edited=true;ui();}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&(active||pending)){event.preventDefault();cancel();}});
$('#edit').onclick=()=>{if(busy)return;cancel();editing=!editing;edited=false;menu=null;render();};
$('#add').onclick=()=>{if(!busy&&photos.length<50)addSample();};
$('#sort').onchange=event=>{cancel();const value=event.target.value;save(value==='date'?photos.map(p=>p.id):restoreManual(order,manual),value==='date'?'촬영순으로 정리했어요.':'직접 배치한 순서로 돌아왔어요.',value);};
$('#settings').onclick=()=>{cancel();$('#settings-panel').hidden=!$('#settings-panel').hidden;$('#settings').setAttribute('aria-expanded',String(!$('#settings-panel').hidden));};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{cancel();mode=button.dataset.mode;editing=false;edited=false;menu=null;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
$('#reset').onclick=()=>initialise($('#many').checked?20:6);$('#many').onchange=()=>initialise($('#many').checked?20:6);
$('#close-preview').onclick=()=>$('#preview').close();
window.addEventListener('pagehide',()=>{cancel();clearTimeout(saveTimer);clearTimeout(toastTimer);});
initialise();
