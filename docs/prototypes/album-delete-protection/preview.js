const shelf=document.querySelector('#albums');
const dialog=document.querySelector('dialog');
const modes=[...document.querySelectorAll('[data-mode]')];
const initial=[
  {id:'spring',title:'함께한 봄날',count:8,cover:'photos/photo-1.webp',linked:true},
  {id:'sea',title:'바닷가에서',count:12,cover:'photos/photo-2.webp',linked:false},
];
let albums=initial.map(album=>({...album})),mode='check',selected=null,step='settings',toastTimer;
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function toast(message){
  document.querySelector('.trial-toast')?.remove();
  const element=document.createElement('div');element.className='trial-toast';element.setAttribute('role','status');element.textContent=message;
  document.body.append(element);clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.remove(),5000);
}

function renderShelf(){
  shelf.innerHTML=albums.map(album=>`<article class="album-card"><a class="album-card-link" href="#albums" data-cover="${album.id}"><div class="album-card-cover"><div class="cover"><img src="${album.cover}" alt="${escape(album.title)} 예시 표지"></div></div><h2>${escape(album.title)}</h2><p class="album-card-meta"><span>사진 ${album.count}장</span></p></a><div class="album-card-menu"><a class="album-watch" href="#albums" data-manage="${album.id}">사진 관리 <span aria-hidden="true">↗</span></a><details class="book-options"><summary aria-label="${escape(album.title)} 더보기" data-menu="${album.id}">···</summary><button type="button" data-settings="${album.id}">앨범 설정</button></details></div></article>`).join('');
  shelf.querySelectorAll('[data-settings]').forEach(button=>button.addEventListener('click',()=>{
    selected=albums.find(album=>album.id===button.dataset.settings);step='settings';
    shelf.querySelectorAll('details').forEach(details=>details.open=false);
    renderDialog();document.body.style.overflow='hidden';dialog.showModal();dialog.querySelector('[data-close]').focus();
  }));
  shelf.querySelectorAll('[data-cover],[data-manage]').forEach(link=>link.addEventListener('click',event=>{
    event.preventDefault();toast('삭제 보호만 비교하는 체험입니다. 앨범의 ···에서 시작해 주세요.');
  }));
}

function closeDialog(){
  const id=selected?.id;
  dialog.close();dialog.innerHTML='';document.body.style.overflow='';selected=null;step='settings';
  document.querySelector(`[data-menu="${id}"]`)?.focus();
}

function summary(){
  return `<div class="album-summary"><img src="${selected.cover}" alt=""><div><h3>${escape(selected.title)}</h3><p>사진 ${selected.count}장</p></div></div>`;
}

function permitted(){
  return mode==='check'?dialog.querySelector('[data-check]')?.checked===true:dialog.querySelector('[data-word]')?.value.trim().normalize('NFC')==='삭제';
}

function renderDialog(){
  if(!selected)return;
  if(step==='settings'){
    dialog.innerHTML=`<header class="dialog-heading"><h2 id="dialog-title">앨범 설정</h2><button type="button" class="dialog-close" data-close aria-label="앨범 설정 닫기">×</button></header>${summary()}<p class="settings-information"><span>굿즈 연결</span><span>${selected.linked?'연결됨':'연결된 굿즈 없음'}</span></p><div class="settings-danger"><button type="button" class="settings-delete" data-delete>앨범 삭제</button></div><button type="button" class="settings-done" data-close>닫기</button>`;
    dialog.querySelector('[data-delete]').addEventListener('click',()=>{step='confirm';renderDialog();dialog.querySelector('[data-cancel]').focus();});
  }else{
    dialog.innerHTML=`<header class="dialog-heading"><h2 id="dialog-title">앨범을 삭제할까요?</h2><button type="button" class="dialog-close" data-close aria-label="삭제 취소하고 닫기">×</button></header>${summary()}<p class="delete-warning">이 앨범과 담긴 사진을 다시 볼 수 없어요.</p>${selected.linked?'<p class="nfc-warning">연결된 굿즈에서도 이 앨범을 새로 열 수 없어요.</p>':''}${mode==='check'?'<label class="delete-check"><input type="checkbox" data-check><span>삭제할 앨범을 확인했어요.</span></label>':'<label class="delete-input-label" for="delete-word">삭제 확인</label><input id="delete-word" type="text" data-word autocomplete="off" spellcheck="false" autocapitalize="off" aria-describedby="word-hint"><p class="delete-input-hint" id="word-hint">위 칸에 ‘삭제’를 입력해 주세요.</p>'}<div class="delete-actions"><button type="button" data-cancel>취소</button><button type="button" class="delete-confirm" data-confirm disabled>앨범 삭제</button></div>`;
    dialog.querySelector('[data-cancel]').addEventListener('click',()=>{step='settings';renderDialog();dialog.querySelector('[data-close]').focus();});
    const update=()=>{dialog.querySelector('[data-confirm]').disabled=!permitted();};
    dialog.querySelector('[data-check]')?.addEventListener('change',update);
    dialog.querySelector('[data-word]')?.addEventListener('input',update);
    dialog.querySelector('[data-word]')?.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
    dialog.querySelector('[data-confirm]').addEventListener('click',()=>{
      if(!permitted()||!selected)return;
      const id=selected.id;albums=albums.filter(album=>album.id!==id);closeDialog();renderShelf();
      modes.find(button=>button.dataset.mode===mode).focus();
      toast('체험용 앨범만 목록에서 숨겼어요. 예시 초기화를 누르면 돌아옵니다.');
    });
  }
  dialog.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',closeDialog));
}

dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();});
document.addEventListener('pointerdown',event=>document.querySelectorAll('details[open]').forEach(details=>{if(!details.contains(event.target))details.open=false;}));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.open)document.querySelectorAll('details[open]').forEach(details=>{details.open=false;details.querySelector('summary').focus();});});
function reset(){
  if(dialog.open)closeDialog();albums=initial.map(album=>({...album}));renderShelf();document.querySelector('.trial-toast')?.remove();
}
modes.forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;modes.forEach(choice=>choice.setAttribute('aria-pressed',String(choice===button)));reset();}));
document.querySelector('[data-reset]').addEventListener('click',reset);
renderShelf();
