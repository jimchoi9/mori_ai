import {createBookPhotos} from './bookPhotos.mjs';

const root=document.querySelector('#root'),dialog=document.querySelector('dialog');
const samples=[
 {src:'photos/photo-1.webp',text:'함께 걸으며 이야기를 나눴다.'},
 {src:'photos/photo-2.webp',text:'바다 앞에서 잠시 쉬었다.'},
 {src:'photos/photo-3.webp',text:'오랜만에 모여 사진을 남겼다.'},
];
const initial=[
 {id:'spring',title:'함께한 봄날',linked:true,photos:samples.map(photo=>({...photo}))},
 {id:'sea',title:'바닷가에서',linked:false,photos:[{...samples[1]},{...samples[0]}]},
];
let albums=structuredClone(initial),cleanup=()=>{},version=0,currentPath='',editing=false,edited=false,toastTimer,returnFocus=null;
const scrolls=new Map();
const path=()=>location.hash.slice(1)||'/albums';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function toast(message){
 document.querySelector('.trial-toast')?.remove();const element=document.createElement('div');element.className='trial-toast';element.setAttribute('role','status');element.textContent=message;document.body.append(element);clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.remove(),5000);
}
function header(){return '<header class="mori-site-header"><a class="mori-home-brand" href="#/albums" aria-label="Mori · 내 앨범"><span class="mori-home-mark" aria-hidden="true">m</span><span>Mori</span></a></header>';}
function bar(){return '<aside class="trial-bar"><p>감상·관리 동선 체험 · 실제 앨범은 바뀌지 않아요.</p><button type="button" data-reset>예시 초기화</button></aside>';}
function shelf(){
 return `<section class="bookshelf-screen"><header class="mori-screen-header"><div><h1>내 앨범</h1></div></header><div class="books">${albums.map(album=>`<article class="album-card"><a class="album-card-link" href="#/albums/${album.id}/view" aria-label="${escape(album.title)} 감상하기"><div class="album-card-cover"><div class="cover"><img src="${album.photos[0].src}" alt="${escape(album.title)} 예시 표지"></div></div><h2>${escape(album.title)}</h2><p class="album-card-meta"><span>사진 ${album.photos.length}장</span></p></a><div class="album-card-menu"><a class="album-watch" href="#/albums/${album.id}/manage">앨범 관리 <span aria-hidden="true">↗</span></a></div></article>`).join('')}</div></section>`;
}
function manage(album){
 return `<section class="content-manager"><header class="content-heading"><div class="management-navigation"><a class="easy-upload-back" href="#/albums" aria-label="내 앨범으로 돌아가기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg><span>내 앨범</span></a><button type="button" class="album-delete-link" data-delete-album>앨범 삭제</button></div><h1 class="album-title"><span class="album-title-text">${escape(album.title)}</span><button type="button" class="album-title-edit" data-rename aria-label="앨범 이름 바꾸기"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/></svg></button></h1><span>${album.photos.length} / 50</span></header><p class="album-capture-period">사진 ${album.photos.length}장</p><div class="content-order-controls"><a class="content-watch" href="#/albums/${album.id}/view">감상하기 →</a><label class="content-sort"><span class="sr-only">사진 정렬</span><select aria-label="사진 정렬"><option>촬영순</option><option>직접 배치</option></select></label></div><ol class="content-pages">${album.photos.map((photo,index)=>`<li><div class="content-photo"><div class="easy-photo"><button type="button" class="easy-photo-open" data-photo="${index}" aria-label="${index+1}번째 사진 확인"><img src="${photo.src}" alt=""></button></div><span class="content-number">${index+1}</span></div><div class="content-caption">${editing?`<textarea aria-label="${index+1}번째 사진 글귀" data-caption="${index}" maxlength="80">${escape(photo.text)}</textarea>`:`<p>${escape(photo.text)}</p>`}</div></li>`).join('')}</ol><footer class="content-footer"><p class="content-upload-state" role="status">${editing?(edited?'변경사항 저장됨':'변경사항 없음'):`사진 ${album.photos.length}장 저장 완료`}</p>${editing?`<button class="content-finish" data-finish>${edited?'저장하고 완료':'완료'}</button>`:'<button type="button" class="content-add" data-add>＋ 사진 추가</button><button type="button" class="content-edit" data-edit>편집</button>'}</footer></section>`;
}
function closeDialog(){dialog.close();dialog.innerHTML='';document.body.style.overflow='';returnFocus?.focus();returnFocus=null;}
function openDialog(contents,focus='[data-cancel]'){
 returnFocus=document.activeElement;dialog.innerHTML=contents;document.body.style.overflow='hidden';dialog.showModal();dialog.querySelector(focus)?.focus();dialog.querySelectorAll('[data-cancel]').forEach(button=>button.addEventListener('click',closeDialog));
}
function heading(title){return `<header class="dialog-heading"><h2 id="dialog-title">${title}</h2><button type="button" class="dialog-close" data-cancel aria-label="취소하고 닫기">×</button></header>`;}
function deleteAlbum(album){
 openDialog(`${heading('앨범을 삭제할까요?')}<div class="album-summary"><img src="${album.photos[0].src}" alt=""><div><h3>${escape(album.title)}</h3><p>사진 ${album.photos.length}장</p></div></div><p class="delete-warning">이 앨범과 담긴 사진을 다시 볼 수 없어요.</p>${album.linked?'<p class="nfc-warning">연결된 굿즈에서도 이 앨범을 새로 열 수 없어요.</p>':''}<label class="input-label" for="delete-word">삭제 확인</label><input id="delete-word" data-word type="text" autocomplete="off" spellcheck="false" autocapitalize="off" aria-describedby="word-hint"><p class="input-hint" id="word-hint">위 칸에 ‘삭제’를 입력해 주세요.</p><div class="dialog-actions"><button type="button" data-cancel>취소</button><button type="button" class="delete-confirm" data-confirm disabled>앨범 삭제</button></div>`,'.dialog-actions [data-cancel]');
 const input=dialog.querySelector('[data-word]'),confirm=dialog.querySelector('[data-confirm]');
 const permitted=()=>input.value.trim().normalize('NFC')==='삭제';
 input.addEventListener('input',()=>{confirm.disabled=!permitted();});input.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
 confirm.addEventListener('click',()=>{if(!permitted())return;albums=albums.filter(item=>item.id!==album.id);closeDialog();location.replace(location.pathname+'#/albums');setTimeout(()=>toast('체험용 앨범만 숨겼어요. 예시 초기화로 돌아옵니다.'),0);});
}
function rename(album){
 openDialog(`${heading('앨범 이름')}<label class="input-label" for="album-name">앨범 이름</label><input type="text" id="album-name" data-name value="${escape(album.title)}" maxlength="40"><p class="input-hint" data-name-error role="alert"></p><div class="dialog-actions"><button type="button" data-cancel>취소</button><button type="button" class="save-confirm" data-save-name>저장</button></div>`,'.dialog-actions [data-cancel]');
 dialog.querySelector('[data-save-name]').addEventListener('click',()=>{const value=dialog.querySelector('[data-name]').value.trim().normalize('NFC');if(!value){dialog.querySelector('[data-name-error]').textContent='앨범 이름을 입력해 주세요.';return;}album.title=value;closeDialog();render();toast('예시 앨범 이름에만 반영했어요.');});
}
function add(album){
 openDialog(`${heading('사진 선택')}<p class="input-hint">체험용 예시 사진입니다. 실제 서비스에서는 휴대폰 사진 선택 창이 열립니다.</p><div class="sample-choices">${samples.map((photo,index)=>`<label><img src="${photo.src}" alt="예시 사진 ${index+1}"><input type="checkbox" data-sample="${index}" aria-label="예시 사진 ${index+1} 선택"></label>`).join('')}</div><div class="dialog-actions"><button type="button" data-cancel>취소</button><button type="button" data-add-samples class="save-confirm" disabled>사진 추가</button></div>`,'.dialog-actions [data-cancel]');
 const checked=()=>[...dialog.querySelectorAll('[data-sample]:checked')];
 dialog.querySelectorAll('[data-sample]').forEach(input=>input.addEventListener('change',()=>{dialog.querySelector('[data-add-samples]').disabled=!checked().length;}));
 dialog.querySelector('[data-add-samples]').addEventListener('click',()=>{const selection=checked();if(!selection.length)return;album.photos.push(...selection.map(input=>({...samples[Number(input.dataset.sample)]})));closeDialog();render();toast('예시 사진을 추가했어요. 실제 업로드는 하지 않았어요.');});
}
async function reader(album,token){
 root.innerHTML='<div class="nfc-experience"><div class="nfc-reader" aria-label="추억책"></div></div>';
 const chapters=await Promise.all(album.photos.map(async photo=>{const media=new Image();media.src=photo.src;await media.decode();return {text:photo.text,src:media.src,media};}));
 if(token!==version)return;
 const photos=createBookPhotos(chapters),book=window.createMemoryBook(root.querySelector('.nfc-reader'),{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,onTurn:index=>photos.nearby(index),onPage:index=>photos.nearby(index)});
 cleanup=()=>{photos.destroy();book.destroy();};
}
function render(){
 cleanup();cleanup=()=>{};const token=++version,current=path(),match=current.match(/^\/albums\/([^/]+)\/(view|manage)$/),album=match&&albums.find(item=>item.id===match[1]),book=!!album&&match[2]==='view';
 document.querySelector('.trial-toast')?.remove();document.body.classList.toggle('nfc-mode',book);
 if(book){void reader(album,token).catch(()=>toast('사진을 불러오지 못했어요. 뒤로 가서 다시 열어 주세요.'));return;}
 root.innerHTML=bar()+`<main id="main-content">${header()}${current==='/albums'?shelf():album?manage(album):'<section><p>예시 앨범이 없습니다.</p><a href="#/albums">내 앨범으로 돌아가기</a></section>'}</main>`;
 root.querySelector('[data-reset]')?.addEventListener('click',()=>{albums=structuredClone(initial);editing=false;edited=false;scrolls.clear();if(current==='/albums')render();else location.hash='/albums';});
 if(album){
  root.querySelector('[data-delete-album]')?.addEventListener('click',()=>deleteAlbum(album));root.querySelector('[data-rename]')?.addEventListener('click',()=>rename(album));root.querySelector('[data-add]')?.addEventListener('click',()=>add(album));
  root.querySelector('[data-edit]')?.addEventListener('click',()=>{editing=true;edited=false;render();});root.querySelector('[data-finish]')?.addEventListener('click',()=>{editing=false;render();});
  root.querySelectorAll('[data-caption]').forEach(input=>input.addEventListener('input',()=>{album.photos[Number(input.dataset.caption)].text=input.value;edited=true;root.querySelector('[data-finish]').textContent='저장하고 완료';root.querySelector('.content-upload-state').textContent='변경사항 저장됨';}));
  root.querySelectorAll('[data-photo]').forEach(button=>button.addEventListener('click',()=>openDialog(`${heading('사진 확인')}<img class="preview-image" src="${album.photos[Number(button.dataset.photo)].src}" alt="예시 사진">`)));
  root.querySelector('select')?.addEventListener('change',()=>toast('정렬·순서 변경은 기존 서비스에서 유지됩니다. 이 체험은 진입 동선만 비교해요.'));
 }
 requestAnimationFrame(()=>scrollTo(0,scrolls.get(current)||0));
}
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeDialog();});
addEventListener('hashchange',()=>{if(dialog.open)closeDialog();scrolls.set(currentPath,scrollY);currentPath=path();editing=false;edited=false;render();});
currentPath=path();render();
