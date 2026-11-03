'use strict';
const $=s=>document.querySelector(s), app=$('#app');
const state={screen:'login',mode:'proposed',name:'지민',registered:false,photos:[],drafts:[],editing:false,manual:false,manualOrder:[],busy:false,done:0,menu:false,sortMenu:false,history:[],selected:new Set(),pickerPhotos:[],lastUpload:0,session:0};
const urls=new Set();let serial=0,toastTimer;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const captions=['바닷가를 따라 천천히 걸었던 오후.','초록빛 산을 바라보며 잠시 쉬었다.','창가에 앉아 함께 마신 따뜻한 커피.','해 질 무렵 다시 찾은 바다.','나란히 앉아 이야기를 나눈 시간.','산책길에서 만난 푸른 풍경.'];
const titles=['바다 산책','초록 능선','오후의 카페','노을 바다','느린 오후','숲속 산책'];
function art(n){
 const palettes=[['#dbe6e3','#8ab8b6','#d5c9af'],['#d8dfca','#79977b','#c0c99f'],['#e4d4bc','#b2916e','#d5c4a7'],['#ecd1b7','#b5b5aa','#d5bda3'],['#e8dec9','#8d9d85','#c8ba99'],['#dce6cc','#6f8b69','#b1c199']];
 const [sky,mid,front]=palettes[n%6];let body='';
 if(n%3===0)body=`<rect y="142" width="600" height="258" fill="${mid}"/><path d="M0 275 Q180 220 330 285 T600 263V400H0Z" fill="${front}"/><path d="M0 221Q150 201 300 223T600 221" fill="none" stroke="#ffffff65" stroke-width="4"/><path d="M0 240Q150 221 300 243T600 241" fill="none" stroke="#ffffff45" stroke-width="2"/><circle cx="455" cy="83" r="31" fill="#fff4d0"/>`;
 else if(n%3===1)body=`<path d="M0 240L155 76 315 270 455 127 600 244V400H0Z" fill="${mid}"/><path d="M0 318Q150 210 280 299T600 278V400H0Z" fill="${front}"/><path d="M300 400Q245 360 310 319T355 287" fill="none" stroke="#eee8d2" stroke-width="17"/><circle cx="450" cy="64" r="23" fill="#f8f0ce"/>`;
 else body=`<rect x="42" y="32" width="310" height="228" rx="5" fill="#f3eee1"/><rect x="53" y="43" width="288" height="206" fill="${mid}"/><path d="M199 43V249M53 146H341" stroke="#f0e8d9" stroke-width="9"/><path d="M0 290L600 245V400H0Z" fill="${front}"/><ellipse cx="305" cy="321" rx="67" ry="22" fill="#a3978133"/><ellipse cx="305" cy="302" rx="51" ry="19" fill="#f8f4e9"/><path d="M265 273H345L338 302Q305 325 272 302Z" fill="#fffcf3"/><ellipse cx="305" cy="273" rx="40" ry="12" fill="#7f6854"/><path d="M345 279Q377 270 372 291Q365 305 342 298" fill="none" stroke="#fffcf3" stroke-width="8"/><path d="M470 271Q420 175 471 119Q523 186 470 271" fill="#74866a"/><path d="M470 260Q500 171 551 177Q548 236 470 260" fill="#8f9d7e"/><path d="M445 260H496L485 315H454Z" fill="#b39476"/>`;
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="${sky}"/>${body}<filter id="g"><feTurbulence baseFrequency=".7" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".045"/></feComponentTransfer></filter><rect width="600" height="400" filter="url(#g)" opacity=".7"/></svg>`);
}
function sample(n){return {id:'p'+(++serial),src:art(n),name:titles[n%6],caption:captions[n%6],date:Date.UTC(2026,9,12)+n*3600000,sample:true};}
function dateText(p){return new Date(p.date).toLocaleDateString('ko-KR',{month:'long',day:'numeric'});}
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').classList.remove('show');$('#toast').textContent='';},2800);}
function go(screen){state.screen=screen;state.menu=false;state.sortMenu=false;state.history.push(({login:'로그인',consent:'첫 이용 동의',claim:'앨범 등록 확인',registered:'등록 완료 · 이동 버튼',album:'내 앨범'})[screen]);render();app.scrollTop=0;if(innerWidth<=740)app.scrollIntoView({block:'start'});}
function experiment(){
 $('#flowNote').innerHTML=state.mode==='current'?'현재 흐름의 핵심 문구를 재현합니다. <b>등록이 끝나도 ‘사진 추가하기’를 한 번 더 누릅니다.</b>':'로그인·최초 등록 확인은 유지합니다. <b>등록이 끝나면 이동 버튼 없이 앨범을 엽니다.</b>';
 $('#journey').innerHTML=state.history.map(s=>`<li>${escape(s)}</li>`).join('');
}
const gift=()=>'<div class="gift-art" aria-hidden="true"><div class="gift-book">mori</div><span class="sprig">❧</span></div>';
const primary=(label,action,disabled=false)=>`<button class="primary" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
function render(){
 experiment();document.querySelector('.phone>.album-footer')?.remove();
 if(state.screen==='login')app.innerHTML=`<section class="entry login-entry"><div class="login-wordmark" aria-label="mori">mori</div><h2 class="sr-only">mori 로그인</h2><img class="login-art" src="album-welcome.svg" width="400" height="350" alt=""><div class="entry-bottom"><button class="social kakao" data-action="login"><span class="login-kakao" aria-hidden="true"></span>카카오로 계속하기</button><button class="social" data-action="login"><span class="login-google" aria-hidden="true">G</span>Google로 계속하기</button></div></section>`;
 if(state.screen==='consent')app.innerHTML=`<section class="entry"><h2>사진 처리 동의</h2><p class="notice">실제 서비스에서는 사진 업로드와 AI 처리 안내가 표시됩니다. 이 목업은 동의 화면의 이동 흐름만 체험합니다.</p><div class="entry-bottom"><label class="check"><input id="consent" type="checkbox"> 사진 업로드·AI 처리 안내에 동의합니다.</label>${primary(state.mode==='current'?'동의하고 책장으로':'동의하고 계속하기','consent',true)}</div></section>`;
 if(state.screen==='claim')app.innerHTML=`<section class="entry">${gift()}<h2>${state.mode==='current'?'선물에 추억을 담아 주세요':'앨범 등록'}</h2><p class="sub">${state.mode==='current'?'나만의 사진첩으로 등록해요.':'등록한 계정에서 사진과 글을 관리해요.'}</p><div class="account-card"><span class="avatar">${escape(state.name[0])}</span><div><strong>${escape(state.name)}님</strong><small>지금 로그인한 계정</small></div><button class="text-btn" data-action="switch-account">변경</button></div><div class="entry-bottom">${primary(state.mode==='current'?'내 앨범 만들기':'내 앨범에 등록','claim')}</div></section>`;
 if(state.screen==='registered')app.innerHTML=`<section class="entry"><div class="success-icon">✓</div><h2>내 사진첩으로<br>등록되었어요.</h2><p class="sub">${state.photos.length?'사진첩을 준비했어요. 내 책장에서 관리 상태를 확인할 수 있어요.':'이제 사진을 추가할 수 있어요.'}</p><div class="notice">현재 코드에서 등록 후 표시하는 상태입니다. 등록은 끝났고, 이 버튼은 다음 화면으로 이동하는 역할입니다.</div><div class="entry-bottom">${primary(state.photos.length?'내 책장':'사진 추가하기','album')}<button class="text-btn" data-action="album">내 책장</button></div></section>`;
 if(state.screen==='album')renderAlbum();
}
function uploadStatus(){
 if(state.busy)return `<section class="upload-status" aria-label="사진 업로드 진행"><strong role="status">${state.drafts.length}장 업로드 중 · ${state.done}/${state.drafts.length}</strong><div class="progress"><i style="width:${state.done/state.drafts.length*100}%"></i></div><p>완료될 때까지 이 화면을 열어두세요.</p></section>`;

 return '';
}
function photoRow(p,i){
 return `<li class="photo-card${state.editing?' is-editing':''}" data-photo="${p.id}"><div class="photo-top"><button class="photo-open" data-action="preview" data-id="${p.id}" aria-label="${i+1}번째 사진 크게 보기"><img src="${escape(p.src)}" alt="${escape(p.name)}" loading="lazy"></button><span class="photo-index">${i+1}</span>${state.editing?`<button class="photo-delete" data-action="delete" data-id="${p.id}" aria-label="${i+1}번째 사진 삭제">−</button>`:''}</div><div class="card-copy">${state.editing?`<textarea data-id="${p.id}" aria-label="${i+1}번째 사진 글" maxlength="80" placeholder="글 입력">${escape(p.caption)}</textarea>`:`<p>${escape(p.caption||'')}</p>`}</div>${state.editing?`<button class="drag-handle" data-id="${p.id}" aria-label="${i+1}번째 사진 순서 변경" aria-describedby="drag-help" title="끌어서 순서 변경 · 키보드 위/아래 화살표"><svg viewBox="0 0 20 26" width="18" height="24" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="5" r="1.8"/><circle cx="14" cy="5" r="1.8"/><circle cx="6" cy="13" r="1.8"/><circle cx="14" cy="13" r="1.8"/><circle cx="6" cy="21" r="1.8"/><circle cx="14" cy="21" r="1.8"/></g></svg></button>`:''}</li>`;
}
function renderAlbum(){
 stopDrag();document.querySelector('.phone>.album-footer')?.remove();
 app.innerHTML=`<header class="album-header"><div><h2>내 앨범 <span class="album-count" aria-label="저장된 사진 ${state.photos.length}장, 최대 50장">${state.photos.length}<span> / 50</span></span></h2></div><button class="avatar-button" data-action="account" aria-label="계정 메뉴" aria-expanded="${state.menu}">${escape(state.name[0])}</button></header>${state.menu?`<nav class="account-menu" aria-label="계정 메뉴"><strong>${escape(state.name)}님의 공간</strong><button data-action="bookshelf">내 앨범</button><button data-action="qr">선물 등록 정보</button><button data-action="logout">로그아웃</button></nav>`:''}<div class="album-controls"><button class="sort-button" data-action="sort-menu" aria-expanded="${state.sortMenu}">${state.manual?'직접 배치':'촬영순'} <span aria-hidden="true">⌄</span></button>${state.sortMenu?`<div class="sort-options" aria-label="사진 정렬"><button data-action="date-sort">촬영 시간순${state.manual?'':' ✓'}</button><button data-action="manual-sort">직접 배치${state.manual?' ✓':''}</button></div>`:''}</div>${uploadStatus()}${!state.photos.length&&!state.busy?`<section class="empty"><div class="empty-photo-icon" aria-hidden="true"><svg viewBox="0 0 64 64" width="56" height="56"><rect x="8" y="10" width="48" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="23" cy="24" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 44L25 34L36 41L45 30L55 40" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div><h3>사진을 추가해 주세요</h3></section>`:''}<p class="sr-only" id="drag-help">손잡이를 끌거나 위아래 방향키를 눌러 순서를 바꿀 수 있습니다.</p><ol class="album-list">${state.photos.map(photoRow).join('')}</ol>${`<footer class="album-footer">${state.editing?'<span class="save-label" role="status">저장됨</span>'+primary('편집 마치기','edit'):state.busy?'<span class="footer-progress" role="status">업로드 중…</span>':primary('＋ 사진 추가','pick',state.photos.length>=50)+`<button class="secondary" data-action="edit" ${!state.photos.length?'disabled':''}>편집</button>`}</footer>`}`;
 document.querySelector('.phone').append(app.querySelector('.album-footer'));
}
function openPicker(){if(state.busy)return;state.selected.clear();state.pickerPhotos=Array.from({length:9},(_,i)=>sample(i));renderPicker();$('#picker').showModal();}
function renderPicker(){
 $('#picker').innerHTML=`<div class="dialog-inner"><header class="dialog-header"><div><h2 id="pickerTitle">추가할 사진 선택</h2><p class="small" style="margin:5px 0 0">${50-state.photos.length}장 더 추가할 수 있어요.</p></div><button class="close" data-action="close-picker" aria-label="사진 선택 닫기">×</button></header><div class="picker-grid">${state.pickerPhotos.map((p,i)=>`<button class="pick" data-action="sample" data-index="${i}" aria-label="사진 ${i+1} 선택" aria-pressed="false"><img src="${escape(p.src)}" alt="${escape(p.name)}"><span></span></button>`).join('')}</div><div class="picker-options"><button data-action="select-all">모두 선택</button><button data-action="files">내 사진 고르기</button></div><p class="small">내 사진은 이 목업에서만 표시돼요. JPG·PNG·WebP로 체험해 주세요.</p><div class="picker-bottom"><p id="selectionStatus" role="status"></p><p class="selection-hint">선택 확인을 누르면 바로 업로드를 시작해요.</p>${primary('사진을 선택해 주세요','confirm-selection',true)}</div></div>`;syncPicker();
}
function syncPicker(){
 document.querySelectorAll('.pick').forEach(el=>{const selected=state.selected.has(+el.dataset.index);el.setAttribute('aria-pressed',selected);el.querySelector('span').textContent=selected?'✓':'';});
 const count=state.selected.size,over=state.photos.length+count-50,button=$('#picker [data-action="confirm-selection"]');button.disabled=!count||over>0;button.textContent=count?`${count}장 선택 확인`:'사진을 선택해 주세요';
 const status=$('#selectionStatus');status.className=over>0?'error':'small';status.textContent=over>0?`최대 50장까지예요. ${over}장을 선택 해제해 주세요.`:count?`${count}장 선택됨 · 아직 업로드 전이에요.`:'사진을 눌러 선택하거나 해제하세요.';
}
function release(p){if(urls.has(p.src)){URL.revokeObjectURL(p.src);urls.delete(p.src);}}
function discard(){stopDrag();state.photos.forEach(release);state.drafts.forEach(release);state.photos=[];state.drafts=[];state.editing=false;state.busy=false;state.done=0;state.lastUpload=0;state.manual=false;state.manualOrder=[];state.session++;}
function confirmAction(title,body,action){const dialog=$('#confirm');dialog.innerHTML=`<div class="dialog-inner"><h2 id="confirmTitle" style="font-size:21px">${title}</h2><p class="sub">${body}</p><div class="confirm-actions"><button data-action="cancel-confirm">취소</button><button class="primary" id="confirmYes">계속하기</button></div></div>`;$('#confirmYes').onclick=()=>{dialog.close();action();};dialog.showModal();}
function reset(){discard();state.history=[];state.registered=false;go('login');}
async function save(){
 if(state.busy||!state.drafts.length||state.photos.length+state.drafts.length>50)return;
 state.busy=true;state.editing=false;state.lastUpload=0;state.done=0;const epoch=state.session;renderAlbum();$('.upload-status').scrollIntoView({block:'nearest'});
 const count=state.drafts.length;
 for(let i=1;i<=count;i++){await new Promise(r=>setTimeout(r,Math.min(400,4000/count)));if(epoch!==state.session)return;state.done=i;const bar=$('.progress>i');if(bar)bar.style.width=(i/count*100)+'%';const status=$('.upload-status [role="status"]');if(status)status.textContent=`${count}장 업로드 중 · ${i}/${count}`;}
 state.photos.push(...state.drafts);state.drafts=[];state.busy=false;state.lastUpload=count;if(!state.manual)state.photos.sort((a,b)=>a.date-b.date);renderAlbum();toast(`${count}장 업로드 완료`);
}
function edit(){state.editing=!state.editing;const y=app.scrollTop,wy=scrollY;renderAlbum();app.scrollTop=y;window.scrollTo(0,wy);}
function showPreview(id){const p=state.photos.find(p=>p.id===id);if(!p)return;$('#preview').innerHTML=`<div class="dialog-inner"><header class="dialog-header"><h2>사진 크게 보기</h2><button class="close" data-action="close-preview" aria-label="확대 사진 닫기">×</button></header><img class="preview-img" src="${escape(p.src)}" alt="${escape(p.name)}"><p class="preview-caption">${escape(p.caption)}</p></div>`;$('#preview').showModal();}
async function handle(action,el){
 const id=el?.dataset.id;
 if(action==='restart')return (state.photos.length||state.drafts.length)?confirmAction('처음부터 다시 볼까요?','목업에서 담은 사진과 글이 초기화됩니다.',reset):reset();
 if(action==='login')return go($('#firstVisit').checked?'consent':'claim');
 if(action==='consent')return go('claim');
 if(action==='claim'){state.registered=true;go(state.mode==='current'?'registered':'album');if(state.mode==='proposed')toast(`${state.name}님의 앨범으로 등록했어요`);return;}
 if(action==='switch-account'){state.name=state.name==='지민'?'민수':'지민';return render();}
 if(action==='album'||action==='open-album'){state.registered=true;return go('album');}
 if(action==='revisit'){state.registered=true;return go(state.mode==='current'?'registered':'album');}
 if(action==='fifty')return confirmAction('샘플 50장을 열까요?','현재 목업 사진을 샘플 50장으로 바꿉니다. 마지막 사진의 편집 완료 버튼도 확인해보세요.',()=>{discard();state.registered=true;state.photos=Array.from({length:50},(_,i)=>sample(i));go('album');toast('샘플 50장을 준비했어요');});
 if(action==='pick')return openPicker();
 if(action==='close-picker')return $('#picker').close();
 if(action==='sample'){const n=+el.dataset.index;state.selected.has(n)?state.selected.delete(n):state.selected.add(n);return syncPicker();}
 if(action==='select-all'){state.selected=new Set(state.pickerPhotos.map((_,i)=>i));return syncPicker();}
 if(action==='confirm-selection'){if(!state.selected.size||state.photos.length+state.selected.size>50)return;state.drafts=[...state.selected].map(i=>state.pickerPhotos[i]);$('#picker').close();return save();}
 if(action==='files')return $('#files').click();
 if(action==='edit')return edit();
 if(action==='sort-menu'){state.sortMenu=!state.sortMenu;return renderAlbum();}
 if(action==='manual-sort'){if(!state.manual&&state.manualOrder.length){const ranks=new Map(state.manualOrder.map((id,i)=>[id,i]));state.photos.sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));}state.manualOrder=state.photos.map(p=>p.id);state.manual=true;state.editing=true;state.sortMenu=false;return renderAlbum();}
 if(action==='date-sort'){if(state.manual)state.manualOrder=state.photos.map(p=>p.id);state.photos.sort((a,b)=>a.date-b.date);state.manual=false;state.sortMenu=false;renderAlbum();return toast('촬영순으로 정렬했어요');}
 if(action==='delete')return confirmAction('이 사진을 뺄까요?','이 목업 앨범에서 사진과 글이 함께 사라집니다.',()=>{const p=state.photos.find(p=>p.id===id);if(p)release(p);state.photos=state.photos.filter(p=>p.id!==id);renderAlbum();});
 if(action==='preview')return showPreview(id);
 if(action==='close-preview')return $('#preview').close();
 if(action==='cancel-confirm')return $('#confirm').close();
 if(action==='account'){state.menu=!state.menu;const y=app.scrollTop;renderAlbum();app.scrollTop=y;return;}
 if(action==='bookshelf'){state.menu=false;renderAlbum();return toast('지금 보고 있는 내 앨범이에요');}
 if(action==='qr'){state.menu=false;renderAlbum();return toast(`${state.name}님의 계정에 등록된 선물이에요`);}
 if(action==='logout')return confirmAction('체험 로그인을 종료할까요?','목업에 담은 사진과 글도 비웁니다.',reset);
}
document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&!el.disabled)void handle(el.dataset.action,el);});
document.addEventListener('pointerdown',event=>{
 if(state.menu&&!event.target.closest('.account-menu,.avatar-button')){state.menu=false;$('.account-menu')?.remove();$('.avatar-button')?.setAttribute('aria-expanded','false');}
 if(state.sortMenu&&!event.target.closest('.album-controls')){state.sortMenu=false;$('.sort-options')?.remove();$('.sort-button')?.setAttribute('aria-expanded','false');}
});
let drag=null,dragFrame=0;
function stopDrag(){cancelAnimationFrame(dragFrame);dragFrame=0;const current=drag;drag=null;if(current?.handle.hasPointerCapture(current.pointer))current.handle.releasePointerCapture(current.pointer);app.querySelectorAll('.dragging,.drop-target').forEach(e=>e.classList.remove('dragging','drop-target'));}
function movePhoto(id,target){const from=state.photos.findIndex(p=>p.id===id),to=state.photos.findIndex(p=>p.id===target);if(from<0||to<0||from===to)return;const y=app.scrollTop,wy=scrollY;const [photo]=state.photos.splice(from,1);state.photos.splice(to,0,photo);state.manualOrder=state.photos.map(p=>p.id);state.manual=true;renderAlbum();app.scrollTop=y;window.scrollTo(0,wy);}
function dragTick(){
 if(!drag)return;
 if(drag.moved){
  const rect=app.getBoundingClientRect(),top=Math.max(rect.top,0)+60,bottom=Math.min(rect.bottom,innerHeight)-85;
  const delta=drag.y<top?-9:drag.y>bottom?9:0;
  if(delta){if(getComputedStyle(app).overflowY==='auto')app.scrollTop+=delta;else window.scrollBy(0,delta);}
  const rows=[...app.querySelectorAll('.photo-card')];
  const nearest=rows.reduce((best,row)=>{const r=row.getBoundingClientRect(),distance=Math.abs(r.top+r.height/2-drag.y);return !best||distance<best.distance?{row,distance}:best;},null);
  app.querySelectorAll('.drop-target').forEach(e=>e.classList.remove('drop-target'));
  if(nearest){drag.target=nearest.row.dataset.photo;if(drag.target!==drag.id)nearest.row.classList.add('drop-target');}
 }
 dragFrame=requestAnimationFrame(dragTick);
}
app.addEventListener('pointerdown',event=>{
 const handle=event.target.closest('.drag-handle');if(!handle||event.button!==0)return;
 stopDrag();handle.setPointerCapture(event.pointerId);drag={id:handle.dataset.id,target:handle.dataset.id,y:event.clientY,start:event.clientY,pointer:event.pointerId,handle,moved:false};dragFrame=requestAnimationFrame(dragTick);
});
app.addEventListener('pointermove',event=>{if(!drag||drag.pointer!==event.pointerId)return;drag.y=event.clientY;if(Math.abs(drag.y-drag.start)>8){drag.moved=true;drag.handle.closest('.photo-card').classList.add('dragging');}});
app.addEventListener('pointerup',event=>{if(!drag||drag.pointer!==event.pointerId)return;const current=drag;stopDrag();if(current.moved)movePhoto(current.id,current.target);});
app.addEventListener('pointercancel',stopDrag);
app.addEventListener('lostpointercapture',()=>{if(drag)stopDrag();});
app.addEventListener('keydown',event=>{const handle=event.target.closest('.drag-handle');if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const from=state.photos.findIndex(p=>p.id===handle.dataset.id),target=state.photos[from+(event.key==='ArrowUp'?-1:1)];if(target){movePhoto(handle.dataset.id,target.id);app.querySelector(`.drag-handle[data-id="${handle.dataset.id}"]`)?.focus();}});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;stopDrag();if(state.menu){state.menu=false;$('.account-menu')?.remove();$('.avatar-button')?.setAttribute('aria-expanded','false');$('.avatar-button')?.focus();}if(state.sortMenu){state.sortMenu=false;$('.sort-options')?.remove();$('.sort-button')?.setAttribute('aria-expanded','false');$('.sort-button')?.focus();}});
document.addEventListener('change',event=>{if(event.target.id==='consent')$('[data-action="consent"]').disabled=!event.target.checked;});
app.addEventListener('input',event=>{if(event.target.matches('textarea[data-id]')){const p=state.photos.find(p=>p.id===event.target.dataset.id);if(p)p.caption=event.target.value;const label=$('.save-label');if(label)label.textContent='저장됨';}});
$('#flow').addEventListener('change',event=>{const mode=event.target.value;if(state.photos.length||state.drafts.length){event.target.value=state.mode;confirmAction('진입 방식을 바꿀까요?','사진을 비우고 선물 QR 로그인부터 다시 시작합니다.',()=>{state.mode=mode;$('#flow').value=mode;reset();});}else{state.mode=mode;reset();}});
$('#files').addEventListener('change',async event=>{
 const files=[...event.target.files];event.target.value='';const epoch=state.session;let rejected=0;
 for(const file of files){if(!/^image\/(jpeg|png|webp)$/.test(file.type)){rejected++;continue;}const src=URL.createObjectURL(file);const image=new Image();image.src=src;try{await image.decode();}catch{URL.revokeObjectURL(src);rejected++;continue;}if(epoch!==state.session||!$('#picker').open){URL.revokeObjectURL(src);break;}urls.add(src);state.selected.add(state.pickerPhotos.length);state.pickerPhotos.push({id:'p'+(++serial),src,name:file.name,caption:'',date:file.lastModified,sample:false});}
 if($('#picker').open)renderPicker();if(rejected)toast('목업에서 표시할 수 없는 사진은 제외했어요. JPG·PNG·WebP로 체험해 주세요.');
});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
$('#picker').addEventListener('close',()=>{for(const p of state.pickerPhotos)if(!state.drafts.includes(p)&&!state.photos.includes(p))release(p);state.pickerPhotos=[];state.selected.clear();});
window.addEventListener('pagehide',()=>{urls.forEach(url=>URL.revokeObjectURL(url));urls.clear();});
go('login');
