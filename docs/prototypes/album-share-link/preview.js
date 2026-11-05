import {openBook} from './visitor.js';
const root=document.querySelector('#root'),panel=document.querySelector('dialog'),slot=document.querySelector('.toast-slot');
const owner=location.pathname.match(/^\/review\/([^/]+)\/$/)?.[1];
const scenarios={ready:'첫 공유',existing:'이미 만든 링크',empty:'사진이 없는 앨범',pending:'사진 저장 중',caption_missing:'글귀 한 개 미완료',create_failure:'발급 실패 후 재시도',lost_reply:'발급 후 응답 끊김',copy_failure:'복사 실패',save_failure:'수정 내용 저장 실패',slow:'느린 발급 중 닫기',long_title:'긴 앨범 이름',paused:'공유 일시 중지'};
const names={a:'관리에서 바로 복사',b:'관리의 공유 패널',c:'목록에서 바로 공유'};
const shareIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M7 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/></svg>';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let all={},mode='b',screen='compare',scenario='ready',busy=false,globalError='',panelError='',manual=false,pauseConfirm=false,returnFocus=null,toastTimer,cleanup=()=>{},viewEpoch=0,copyAttempts={},events=[];
const album=()=>all[mode];
const url=()=>album()?.link?location.origin+album().link:'';
const event=name=>events.push({mode,action:name,time:Math.round(performance.now())});
async function api(action,body={}){
 const response=await fetch('/demo/owner/'+action,{method:action==='state'?'GET':'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-Prototype-Owner':owner},...(action==='state'?{}:{body:JSON.stringify({mode,...body})})});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'REQUEST_FAILED'),{code:data.error});return data;
}
function toast(text){(panel.open?panel:document.body).append(slot);slot.innerHTML='';const node=document.createElement('div');node.className='trial-toast';node.textContent=text;slot.append(node);clearTimeout(toastTimer);toastTimer=setTimeout(()=>slot.replaceChildren(),4200);}
function header(){return '<header class="mori-site-header"><a class="mori-home-brand" href="#shelf" data-route="shelf" aria-label="Mori · 내 앨범"><span class="mori-home-mark" aria-hidden="true">m</span><span>Mori</span></a><span class="demo-avatar" aria-label="체험용 내 계정">나</span></header>';}
function route(next,push=true){clearTimeout(toastTimer);slot.replaceChildren();viewEpoch++;closePanel();cleanup();document.body.classList.remove('nfc-mode');cleanup=()=>{};globalError='';screen=next;if(push)history.pushState({mode,screen},'',location.pathname+`#${mode}/${next}`);render();scrollTo(0,0);}
function comparison(){return `<main id="main-content">${header()}<section class="trial-intro"><span class="eyebrow">Mori · 감상 링크 비교 체험</span><h1>추억을 건네는 방법을<br>직접 눌러보세요.</h1><p>내 앨범에서 링크를 꺼내고, 받은 사람이 로그인 없이 책을 여는 흐름을 비교합니다.</p><p class="demo-note">체험용 앨범만 사용해요. 실제 앨범이나 사진은 공개되지 않습니다.</p><label class="scenario-picker">체험할 상황<select id="scenario" aria-label="체험할 상황">${Object.entries(scenarios).map(([id,name])=>`<option value="${id}" ${scenario===id?'selected':''}>${name}</option>`).join('')}</select></label><div class="choice-grid">${['a','b','c'].map(m=>`<button class="choice" data-start="${m}"><span>${m.toUpperCase()}</span><span><strong>${names[m]}</strong><small>${{a:'관리에서 누르면 링크를 만들고 바로 복사해요.',b:'작은 패널에서 공유 범위를 보고, 만들기와 복사를 이어가요.',c:'관리 화면을 거치지 않고 목록에서 공유를 시작해요.'}[m]}</small></span><span class="choice-arrow" aria-hidden="true">→</span></button>`).join('')}</div><details class="trial-extra"><summary>체험 안내 · 상황 초기화</summary><p>각 방식은 독립된 예시입니다. 만든 링크를 다시 복사하거나, 다른 브라우저에서 열어볼 수 있어요. 사진 저장·글귀 실패·네트워크 오류는 선택한 상황에 맞춰 가상으로 재현합니다.</p><button data-reset>이 상황 처음부터</button><p>링크 만들기·복사는 실제 체험 서버에서 동작합니다. 실제 서비스의 발급 기능은 이 비교 후에 연결합니다.</p></details><details class="trial-extra"><summary>체험 기록</summary><pre>${escape(events.map(e=>`${e.mode.toUpperCase()} · ${e.action}`).join('\n')||'방식을 눌러 체험을 시작해 주세요.')}</pre></details></section></main>`;}
function shareButton(where='manage'){
 const a=album(),direct=mode==='a'&&where==='manage';
 return `<button class="share-entry${direct?' is-direct':''}" data-share ${busy?'disabled':''} aria-label="${direct?'감상 링크 복사':'앨범 공유'}">${direct?'':shareIcon}<span>${busy?'확인 중…':direct?'감상 링크 복사':'공유'}</span></button>`;
}
function shelf(){const a=album();return `<section class="bookshelf-screen"><header class="mori-screen-header"><div><h1>내 앨범</h1></div><button class="album-create" data-unrelated>＋ 새 앨범</button></header><div class="books"><article class="album-card"><a class="album-card-link" href="#view" data-view><div class="album-card-cover"><div class="cover">${a.photos.length?'<img src="/assets/photo-1.svg" alt="체험용 앨범 표지">':'<span class="cover-add">＋</span><span class="cover-add-label">사진 추가</span>'}</div></div><h2>${escape(a.title)}</h2><p class="album-card-meta"><span>2026.07.18–2026.07.20</span><span>사진 ${a.count}장</span></p></a><div class="album-card-menu"><a class="album-watch" href="#manage" data-route="manage">앨범 관리 <span aria-hidden="true">↗</span></a>${mode==='c'?shareButton('shelf'):''}</div></article><article class="album-card"><div class="album-card-cover"><div class="cover"><img src="/assets/photo-2.svg" alt="다른 체험용 앨범 표지"></div></div><h2>바닷가에서 · 예시</h2><p class="album-card-meta"><span>2026.05.03</span><span>사진 3장</span></p><div class="album-card-menu"><button class="album-watch" data-unrelated>앨범 관리 ↗</button></div></article></div><footer class="albums-goods-link">공유 체험은 ‘함께한 여름’ 앨범으로 진행해요.</footer></section>`;}
function manage(){const a=album();return `<section class="content-manager"><header class="content-heading"><div class="album-management-navigation"><a class="easy-upload-back" href="#shelf" data-route="shelf" aria-label="내 앨범으로 돌아가기"><span aria-hidden="true">〈</span><span>내 앨범</span></a><button class="album-delete-link" data-unrelated>앨범 삭제</button></div><h1 class="album-title"><span class="album-title-text">${escape(a.title)}</span><button class="album-title-edit" data-unrelated aria-label="앨범 이름 바꾸기">✎</button></h1><span>${a.count} / 50</span></header><p class="album-capture-period">${a.count?'2026.07.18–2026.07.20 · ':''}사진 ${a.count}장</p><div class="content-order-controls"><a class="content-watch" href="#view" data-view>감상하기 →</a>${shareButton()}<label class="content-sort"><span class="sr-only">사진 정렬</span><select aria-label="사진 정렬"><option>촬영순</option><option>직접 배치</option></select></label></div>${globalError?`<div class="trial-error" role="alert"><p>${escape(globalError)}</p><button data-share>다시 시도</button></div>`:''}${!a.saved?'<p class="trial-hint">저장 대기 중인 글귀가 있어요. 공유를 시작하면 먼저 저장을 확인합니다.</p>':''}${a.pending?'<p class="trial-hint">사진을 저장하고 있어요. <button data-update>체험: 저장 마무리</button></p>':''}${!a.count?'<div class="content-empty"><p>사진을 추가해 주세요</p></div>':`<ol class="content-pages">${a.photos.map((p,i)=>`<li><div class="content-photo"><div class="easy-photo"><img src="/assets/${p.asset}" alt="${i+1}번째 체험용 사진"></div><span class="content-number">${i+1}</span></div><div class="content-caption">${!a.saved&&i===0?'<textarea readonly aria-label="저장 대기 중인 예시 글귀">수정한 글귀도 저장한 뒤 함께 나눴다.</textarea>':`<p>${a.pending?'사진을 저장하고 있어요.':escape(p.text||'글귀를 직접 적어주세요.')}</p>`}</div></li>`).join('')}</ol>`}<footer class="content-footer"><p class="content-upload-state" role="status">${!a.saved?'변경사항 저장 대기':a.pending?'사진 저장 중…':`사진 ${a.count}장 저장 완료`}</p><button class="content-add" data-unrelated>＋ 사진 추가</button><button class="content-edit" data-unrelated>편집</button></footer></section>`;}
function render(){
 if(screen==='compare'){root.innerHTML=comparison();bind();return;}
 root.innerHTML=`<aside class="trial-top"><div><strong>${mode.toUpperCase()} · ${names[mode]}</strong><p>체험용 앨범 · ${scenarios[scenario]}</p></div><a href="#compare" data-route="compare">다른 방식 보기</a></aside><main id="main-content">${header()}${screen==='manage'?manage():shelf()}<details class="trial-extra"><summary>체험용 내용 바꿔보기</summary><p>링크를 만든 뒤 저장된 글귀를 바꾸고, 같은 링크를 새로 열어보세요. 원래 열어둔 책은 그대로이고 다음 감상부터 반영돼요.</p><button data-update>체험: 사진·글귀 업데이트</button><p><a href="#" data-recipient target="_blank" rel="noopener noreferrer">로그인하지 않은 사람으로 열기 ↗</a><br><a href="#" data-friend target="_blank" rel="noopener noreferrer">다른 계정으로 열기 ↗</a></p></details></main>`;bind();
}
function bind(){
 root.querySelectorAll('[data-recipient],[data-friend]').forEach(link=>link.addEventListener('click',e=>{if(!album().link){e.preventDefault();toast('먼저 감상 링크를 만들어 주세요.');return;}const target=new URL(url());if(link.hasAttribute('data-friend'))target.searchParams.set('visitor','friend');link.href=target.href;}));
 root.querySelectorAll('[data-start]').forEach(b=>b.addEventListener('click',async()=>{if(busy)return;mode=b.dataset.start;event('비교 시작');route(scenario==='save_failure'?'manage':'shelf');}));
 root.querySelectorAll('[data-route]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();event('이동 '+a.dataset.route);route(a.dataset.route);}));
 root.querySelectorAll('[data-share]').forEach(b=>b.addEventListener('click',()=>void startShare()));
 root.querySelectorAll('[data-unrelated]').forEach(b=>b.addEventListener('click',()=>toast('이 체험에서는 공유 흐름만 동작해요.')));
 root.querySelectorAll('[data-update]').forEach(b=>b.addEventListener('click',async()=>{try{all[mode]=await api('update');render();toast('체험용 앨범을 바꿨어요. 같은 링크를 새로 열어보세요.');event('저장 내용 업데이트');}catch{toast('체험용 앨범을 바꾸지 못했어요.');}}));
 root.querySelectorAll('[data-view]').forEach(a=>a.addEventListener('click',async e=>{e.preventDefault();try{const epoch=++viewEpoch,which=mode;const data=await api('preview');if(epoch!==viewEpoch||mode!==which)return;closePanel();screen='view';history.pushState({mode,screen:'view'},'',location.pathname+`#${mode}/view`);cleanup();cleanup=await openBook(root,data,{libraryHref:location.pathname+`#${mode}/shelf`,isCurrent:()=>screen==='view'&&epoch===viewEpoch});}catch{toast('감상 자료를 불러오지 못했어요.');}}));
 root.querySelector('#scenario')?.addEventListener('change',async e=>{scenario=e.target.value;await reset();});
 root.querySelector('[data-reset]')?.addEventListener('click',()=>void reset());
}
async function reset(){if(busy)return;busy=true;try{for(const m of 'abc')all[m]=await api('setup',{mode:m,scenario});copyAttempts={};events=[];event('상황 초기화');render();}finally{busy=false;}}
async function startShare(){
 if(busy)return;const target=mode,wasDirect=mode==='a';event('공유 시작');globalError='';
 try{
  if(!album().saved){busy=true;render();all[target]=await api('prepare',{mode:target});busy=false;render();event('변경사항 저장 확인');}
  if(wasDirect&&album().active){await copyCurrent(true);return;}
  if(wasDirect&&!album().link){await createLink(true);return;}
  showPanel();
 }catch(e){busy=false;globalError=e.code==='SAVE_FAILED'?'변경사항을 저장하지 못했어요. 다시 시도해 주세요.':'공유 정보를 확인하지 못했어요. 다시 시도해 주세요.';event('저장 확인 실패 · 링크 발급 안 함');render();}
}
function showPanel(){panelError='';manual=false;pauseConfirm=false;returnFocus=root.querySelector('[data-share]')||document.activeElement;renderPanel();panel.showModal();document.body.style.overflow='hidden';panel.querySelector('.sheet-close').focus({preventScroll:true});event('공유 패널 열기');}
function closePanel(){if(!panel.open)return;document.body.append(slot);panel.close();panel.innerHTML='';document.body.style.overflow='';returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});returnFocus=null;pauseConfirm=false;event('공유 패널 닫기');}
function renderPanel(){
 const a=album(),issued=!!a.link,paused=issued&&!a.active;
 const primary=paused?'공유 다시 켜기':issued?'링크 복사':panelError.startsWith('결과')?'링크 다시 확인':panelError?'다시 시도':'감상 링크 만들기';
 panel.innerHTML=`<div class="sheet-body"><div class="sheet-grip" aria-hidden="true"></div><header class="sheet-heading"><h2 id="share-title">이 앨범 공유하기</h2><button class="sheet-close" aria-label="공유 패널 닫기" data-close>×</button></header><div class="sheet-album">${a.photos.length?`<img src="/assets/${a.photos[0].asset}" alt="">`:'<span class="sheet-empty-cover" aria-hidden="true">▤</span>'}<div><h3>${escape(a.title)}</h3><p>사진 ${a.count}장</p></div></div><p class="share-scope">링크를 받은 사람은 로그인 없이<br>이 앨범만 감상할 수 있어요.</p>${!a.count?'<p class="share-status">사진을 추가하면 같은 링크로 볼 수 있어요.</p>':a.pending?'<p class="share-status">사진 저장이 끝나면 같은 링크로 볼 수 있어요.</p>':paused?'<p class="share-status">이 링크와 NFC로 새로 열 수 없는 상태예요.</p>':issued?'<p class="share-status">감상 링크가 준비됐어요.</p>':''}${panelError?`<p class="sheet-issue-error" role="alert">${escape(panelError)}</p>`:''}${manual&&issued?`<div class="manual-block"><label for="manual-url">감상 링크</label><input id="manual-url" readonly value="${escape(url())}" aria-label="감상 링크 주소"><p>${panelError?'자동으로 복사하지 못했어요. ':''}주소를 길게 눌러 직접 복사해 주세요.</p><button data-select>주소 선택</button></div>`:''}<button class="share-primary" data-primary ${busy?'disabled':''}>${busy?'확인 중…':primary}</button>${issued&&a.active&&typeof navigator.share==='function'?'<button class="share-secondary" data-send>다른 앱으로 보내기</button>':''}<p class="share-nfc">NFC에도 같은 링크를 사용해요.</p>${issued?`<details class="link-options" ${pauseConfirm?'open':''}><summary>링크 관리</summary>${pauseConfirm?'<p>이 링크로 새로 열 수 없게 할까요?<br>같은 주소를 기록한 NFC도 함께 멈춰요.</p><div class="inline-actions"><button data-cancel-pause>계속 공유</button><button data-confirm-pause>공유 잠시 끄기</button></div>':`<p>사진·글귀를 바꾸면 다음 감상부터 반영돼요.</p><button data-manual>주소를 직접 복사하기</button>${a.active?'<br><button data-pause>공유 잠시 끄기</button>':'<p>다시 켜면 기존 링크와 NFC를 그대로 사용할 수 있어요.</p>'}`}</details>`:''}</div>`;
 panel.querySelector('[data-close]').addEventListener('click',closePanel);
 panel.querySelector('[data-primary]').addEventListener('click',()=>void(paused?setActive(true):issued?copyCurrent():createLink()));
 panel.querySelector('[data-select]')?.addEventListener('click',()=>{const input=panel.querySelector('input');input.focus({preventScroll:true});input.select();input.setSelectionRange(0,input.value.length);event('직접 복사 주소 선택');});
 panel.querySelector('[data-manual]')?.addEventListener('click',()=>{manual=true;renderPanel();event('직접 복사 열기');});
 panel.querySelector('[data-pause]')?.addEventListener('click',()=>{pauseConfirm=true;renderPanel();});
 panel.querySelector('[data-cancel-pause]')?.addEventListener('click',()=>{pauseConfirm=false;renderPanel();});
 panel.querySelector('[data-confirm-pause]')?.addEventListener('click',()=>void setActive(false));
 panel.querySelector('[data-send]')?.addEventListener('click',()=>void send());
 if(panel.open&&slot.childElementCount)panel.append(slot);
 if(panel.open&&!panel.contains(document.activeElement))panel.querySelector('[data-close]').focus({preventScroll:true});
}
async function createLink(direct=false){
 if(busy)return;const target=mode;busy=true;panelError='';if(panel.open)renderPanel();else render();event('링크 발급 요청');
 try{
  all[target]=await api('issue',{mode:target});event('링크 발급 확인');busy=false;
  if(mode!==target)return;
  if(direct)await copyCurrent(true);
  else if(panel.open){renderPanel();panel.querySelector('[data-primary]').focus({preventScroll:true});}
 }catch(e){
  busy=false;event('발급 응답 실패 · 재시도는 같은 링크');
  const message=e.code==='REPLY_LOST'?'결과를 확인하지 못했어요. 다시 확인하면 같은 링크를 불러와요.':'링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.';
  if(mode!==target)return;
  if(direct){globalError=message;render();}else if(panel.open){panelError=message;renderPanel();}
 }finally{busy=false;}
}
async function copyText(text){
 copyAttempts[mode]=(copyAttempts[mode]||0)+1;
 if(scenario==='copy_failure'&&copyAttempts[mode]===1)throw Error('DEMO_COPY_DENIED');
 if(navigator.clipboard?.writeText&&window.isSecureContext){try{await navigator.clipboard.writeText(text);return;}catch{/* Continue only if the explicit fallback succeeds. */}}
 const field=document.createElement('textarea');field.value=text;field.setAttribute('readonly','');field.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
 (panel.open?panel:document.body).append(field);field.select();field.setSelectionRange(0,text.length);let copied=false;
 try{copied=document.execCommand('copy');}finally{field.remove();}
 if(!copied)throw Error('COPY_DENIED');
}
async function copyCurrent(direct=false){
 if(!album().link||!album().active)return;
 try{await copyText(url());manual=false;panelError='';event('복사 성공');if(panel.open)renderPanel();else render();toast('감상 링크를 복사했어요.');}
 catch{event('복사 실패 · 같은 링크 유지');if(!panel.open)showPanel();manual=true;panelError='링크는 준비됐지만 자동으로 복사하지 못했어요.';renderPanel();}
}
async function send(){
 try{await navigator.share({title:album().title,text:'함께한 기억을 책으로 담았어요.',url:url()});event('시스템 공유 완료');}
 catch(e){if(e.name==='AbortError'){event('시스템 공유 취소 · 링크 유지');return;}panelError='보내기를 열지 못했어요. 링크 복사를 이용해 주세요.';renderPanel();event('시스템 공유 실패');}
}
async function setActive(active){
 if(busy)return;busy=true;renderPanel();
 try{all[mode]=await api('active',{active});pauseConfirm=false;event(active?'같은 링크로 공유 재개':'공유 일시 중지');toast(active?'같은 링크로 다시 감상할 수 있어요.':'이 링크와 NFC의 새 감상을 잠시 껐어요.');}
 catch{panelError='공유 상태를 바꾸지 못했어요. 다시 시도해 주세요.';}
 finally{busy=false;if(panel.open)renderPanel();}
}
panel.addEventListener('cancel',e=>{e.preventDefault();closePanel();});
panel.addEventListener('click',e=>{if(e.target!==panel)return;const r=panel.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePanel();});
addEventListener('popstate',()=>{const match=location.hash.match(/^#([abc])\/(shelf|manage|view)$/);if(match){mode=match[1];route(match[2]==='view'?'shelf':match[2],false);}else route('compare',false);});
try{all=await api('state');render();}catch{root.innerHTML='<main><h1>체험 서버에 연결하지 못했어요.</h1><p>같은 Wi-Fi에서 체험 주소를 다시 열어 주세요.</p></main>';}
