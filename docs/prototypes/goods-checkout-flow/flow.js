import {art,check,right,pencil} from './art.js';
const $=id=>document.getElementById(id),app=$('app');
const options={flow:$('flow'),product:$('product'),account:$('account'),ending:$('ending')};
const state={stage:'results',chosen:1,editing:1,draft:'',gift:false,logged:true,clicks:0,photos:0,saved:new Set(),hole:{x:150,y:32},afterLogin:null,notice:'',busy:false};
let epoch=0,timer,noticeTimer;
const escapeText=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const product=()=>options.product.value==='magnet'?'마그네틱':'키링';
const short=()=>options.flow.value==='short';
const selectedArt=(id=state.chosen,prefix='chosen')=>art(id,prefix);
const button=(action,text,classes='primary',disabled=false)=>`<button type="button" data-action="${action}" class="${classes}"${disabled?' disabled':''}>${text}</button>`;
const header=()=>`<header class="site-header"><div class="brand"><span class="brand-mark" aria-hidden="true">m</span>Mori</div><span class="context">${product()} · 일러스트</span></header>`;
const back=(target,label)=>button(`back-${target}`,`‹ ${label}`,'back');
const sampleNote='<p class="order-note">테스트 구매 · 실제 결제·제작·배송은 없습니다.</p>';
function summary(){return `<div class="summary"><div class="art">${selectedArt(state.chosen,'summary')}</div><div><h2>선택한 시안 ${state.chosen}</h2><p>일러스트 ${product()}</p><p>약 5 × 5 cm</p></div></div>`;}
function placement(){
 if(options.product.value!=='keyring')return '';
 const marker=`<circle cx="${state.hole.x}" cy="${state.hole.y}" r="7" fill="#fffef9" stroke="#315541" stroke-width="3"/><circle cx="${state.hole.x}" cy="${state.hole.y}" r="15" fill="none" stroke="#315541" stroke-width="2"/>`;
 return `<fieldset class="field-group"${state.busy?' disabled':''}><legend>고리 위치</legend><p class="field-hint">그림의 테두리 근처를 눌러 골라 주세요.</p><div class="placement" id="placement">${selectedArt(state.chosen,'placement').replace('</svg>',marker+'</svg>')}</div><div class="position-buttons">${button('hole-left','왼쪽 위','secondary')}${button('hole-top','위쪽 가운데','secondary')}${button('hole-right','오른쪽 위','secondary')}</div><p class="field-hint">위치는 화면 체험용 예시입니다.</p></fieldset>`;
}
function recipientChoice(legacy=false){
 if(legacy)return `<label class="legacy-gift"><input id="legacy-gift" type="checkbox"${state.busy?' disabled':''}${state.gift?' checked':''}>선물받는 사람이 사진을 채울 거예요</label>`;
 return `<fieldset class="field-group"><legend>누가 사진을 채울까요?</legend><label class="choice"><input type="radio" name="photo-owner" value="self"${state.busy?' disabled':''}${!state.gift?' checked':''}><span>내가 채울게요</span></label><label class="choice"><input type="radio" name="photo-owner" value="recipient"${state.busy?' disabled':''}${state.gift?' checked':''}><span>선물받는 분이 채울 거예요</span></label><p id="gift-help" class="field-hint"${state.gift?'':' hidden'}>받는 분이 선물 QR을 열고 로그인한 뒤 앨범을 등록해요.</p></fieldset>`;
}
function cards(){
 return [1,2].map(id=>`<article class="revision" aria-label="시안 ${id}"><p class="message-label">Mori · 시안 ${id}</p><div class="design-card${state.editing===id?' is-editing':''}"><div class="art">${art(id,'card')}</div><div class="art-actions"><button type="button" class="primary buy" data-buy="${id}">이 시안으로 구매하기 ${right}</button><button type="button" class="secondary${state.editing===id?' edit-selected':''}" data-edit="${id}"${state.editing===id?' disabled':''}>${state.editing===id?check+'수정 대상으로 선택됨':pencil+'이 시안 수정하기'}</button></div></div></article>`).join('');
}
function reference(){return `<div class="reference-thumbnail">${art(state.editing,'reference')}</div><strong>시안 ${state.editing} 수정 중</strong>`;}
function results(){return `<div class="conversation proposed"><p class="user-message"><small>새 디자인 만들기</small>바닷가에서 함께 찍은 사진으로 만들어 줘.</p><section id="cards" aria-label="디자인 대화">${cards()}</section><div class="composer"><div class="edit-reference" id="edit-reference" role="status">${reference()}</div><label for="request">어떻게 바꿀까요?</label><textarea id="request" rows="3" placeholder="예: 배경을 단순하게 해 주세요.">${escapeText(state.draft)}</textarea><div class="composer-tools"><button class="send" id="send" type="button" data-action="send" aria-label="수정 요청 보내기"${state.draft.trim()?'':' disabled'}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg></button></div></div><p class="send-status" id="send-status" role="status"></p></div>`;}
function review(){
 const saved=state.saved.has(state.chosen),checkoutLabel=state.logged?(state.gift?'테스트 구매하고 선물 준비하기':'테스트 구매하고 사진 채우기'):'로그인하고 구매 계속하기';
 return `<section class="order">${back('results','시안 다시 고르기')}<h1>구매 내용 확인</h1><p class="order-intro">선택한 디자인과 상품을 확인해 주세요.</p>${summary()}${placement()}${recipientChoice()}${button('checkout',state.busy?'구매 준비 중…':checkoutLabel,'primary',state.busy)}${sampleNote}<div class="save-only">${button('save-only',saved?check+'디자인 저장됨':'디자인만 저장','secondary',saved||state.busy)}<p>내 디자인에 보관하고 나중에 구매할 수 있어요.</p></div></section>`;
}
function legacyPreview(){return `<section class="order">${back('results','대화로 돌아가기')}<h1>굿즈 미리보기</h1><p class="order-intro">나만의 아크릴 ${product()}</p><div class="preview-art art">${selectedArt(state.chosen,'preview')}</div>${placement()}<p class="field-hint">실물과 차이가 있을 수 있는 미리보기입니다.</p>${button('legacy-save','디자인 완성하고 저장')}${button('back-results','대화에서 더 수정하기','text-button')}</section>`;}
function legacySaved(){return `<section class="order"><h1>내 디자인에 저장했어요</h1><p class="order-intro">이제 굿즈에 담을 사진을 더해 보세요.</p>${summary()}<div class="legacy-checkout"><h2>굿즈에 담을 사진을 추가해 보세요</h2><p>지금은 결제 없이 구매 이후 과정을 체험할 수 있어요. 버튼을 누르면 이 디자인의 사진첩이 자동으로 연결됩니다.</p>${recipientChoice(true)}${button('checkout','테스트 결제하고 사진 추가하기')}${sampleNote}</div></section>`;}
function login(){return `<section class="order">${back(short()?'review':'preview','이전 화면으로')}<h1>로그인하고 이어가기</h1><p class="order-intro">선택한 디자인과 설정은 그대로 이어져요.</p>${summary()}${button('login','샘플 계정으로 로그인')}<p class="order-note">실제 계정에 로그인하지 않는 체험입니다.</p></section>`;}
function receipt(){return `<section class="order"><h1>구매가 완료됐어요</h1><p class="order-intro">사진을 담아 나만의 사진첩을 만들어 보세요.</p>${summary()}${button('photos','사진 채우기')}${sampleNote}</section>`;}
function gift(){return `<section class="order"><h1>선물 앨범이 준비됐어요</h1><p class="order-intro">받는 분이 사진을 채울 수 있도록 등록 안내를 전달해 주세요.</p>${summary()}<div class="gift-note"><strong>사진을 채울 사람 · 선물받는 분</strong><p>받는 분이 선물 QR을 열고 로그인한 뒤 ‘내 앨범에 등록’을 누르면 사진을 추가할 수 있어요.</p><p class="field-hint">이 체험에는 실제 등록 QR이나 링크가 없습니다.</p></div>${sampleNote}</section>`;}
function registration(){return `<section class="order"><h1>선물 앨범 등록</h1><p class="order-intro">선물받는 분이 로그인한 뒤 보는 화면입니다.</p>${summary()}<p class="gift-note"><strong>선물받는 분의 체험 계정</strong>에 앨범을 등록합니다.</p>${button('claim','내 앨범에 등록')}<p class="order-note">명시적으로 등록한 계정에서 사진을 관리해요.</p></section>`;}
function album(){return `<section class="album"><p class="album-confirmation" role="status">${state.gift?'선물 앨범 등록 완료':'테스트 구매 완료'} · 사진 ${state.photos}장</p><h1>나의 사진첩</h1>${state.photos?`<div class="album-photos">${Array.from({length:state.photos},(_,i)=>`<div class="art">${art(i%2+1,'album-'+i)}</div>`).join('')}</div>`:'<div class="album-empty"><p>사진을 추가해 주세요.</p></div>'}<details class="order-details"><summary>구매한 굿즈·주문 내역</summary>${summary()}${sampleNote}</details><footer class="album-footer"><p role="status">${state.photos?'사진 '+state.photos+'장 저장 완료':'앨범을 채울 준비가 됐어요.'}</p>${button('add-photos','＋ 사진 추가','primary',state.photos>=50)}</footer></section>`;}
function render(){
 const views={results,review,preview:legacyPreview,saved:legacySaved,login,receipt,gift,registration,album};
 app.innerHTML=header()+views[state.stage]();
 $('lab-progress').textContent=`${short()?'합친 흐름':'현재 구조'} · 진행 버튼 ${state.clicks}회 (로그인·고리 위치 선택 제외)`;
 $('recipient-demo').hidden=state.stage!=='gift';
 if(state.notice)showNotice(state.notice,false);
}
function go(stage){state.stage=stage;render();window.scrollTo({top:0,behavior:'instant'});}
function reset(){epoch++;clearTimeout(timer);clearTimeout(noticeTimer);Object.assign(state,{stage:'results',chosen:1,editing:1,draft:'',gift:false,logged:options.account.value==='member',clicks:0,photos:0,saved:new Set(),hole:{x:150,y:32},afterLogin:null,notice:'',busy:false});render();window.scrollTo({top:0,behavior:'instant'});}
function showNotice(text,start=true){
 $('flow-notice')?.remove();const node=document.createElement('div');node.id='flow-notice';node.className='flow-toast';node.setAttribute('role','status');node.textContent=text;app.append(node);
 if(start){state.notice=text;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{state.notice='';$('flow-notice')?.remove();},6000);}
}
function saveOnly(){state.saved.add(state.chosen);render();showNotice('디자인을 저장했어요. 내 디자인에서 다시 볼 수 있어요.');}
function checkout(){
 state.clicks++;
 if(!state.logged){state.afterLogin='checkout';go('login');return;}
 state.busy=true;render();const run=epoch,gift=state.gift;
 timer=setTimeout(()=>{if(run!==epoch)return;state.busy=false;state.saved.add(state.chosen);if(gift)go('gift');else if(short()&&options.ending.value==='direct'){go('album');showNotice('테스트 구매가 완료됐어요. 사진을 추가해 보세요.');}else go('receipt');},650);
}
app.addEventListener('click',event=>{
 const edit=event.target.closest('[data-edit]'),buy=event.target.closest('[data-buy]');
 if(edit){if(edit.disabled)return;state.editing=Number(edit.dataset.edit);$('cards').innerHTML=cards();$('edit-reference').innerHTML=reference();$('send-status').textContent='';return;}
 if(buy){state.chosen=Number(buy.dataset.buy);state.clicks++;state.notice='';go(short()?'review':'preview');return;}
 const target=event.target.closest('[data-action]');if(!target||target.disabled||state.busy)return;const action=target.dataset.action;
 if(action.startsWith('back-')){state.notice='';go(action.slice(5));}
 else if(action==='checkout')checkout();
 else if(action==='save-only'){if(!state.logged){state.afterLogin='save-only';go('login');}else saveOnly();}
 else if(action==='legacy-save'){state.clicks++;if(!state.logged){state.afterLogin='legacy-save';go('login');}else{state.saved.add(state.chosen);go('saved');}}
 else if(action==='login'){state.logged=true;const next=state.afterLogin;state.afterLogin=null;if(next==='legacy-save'){state.saved.add(state.chosen);go('saved');}else{go('review');if(next==='save-only')saveOnly();}}
 else if(action==='photos'){state.clicks++;go('album');}
 else if(action==='claim'){state.clicks++;go('album');showNotice('선물 앨범을 등록했어요. 이제 사진을 추가할 수 있어요.');}
 else if(action==='add-photos'){const before=state.photos;state.photos=Math.min(50,state.photos+3);render();showNotice(`샘플 사진 ${state.photos-before}장을 저장했어요.`);}
 else if(action==='send'){$('send-status').textContent='이 체험에서는 새 이미지를 만들지 않아요.';}
 else if(action.startsWith('hole-')){state.hole={x:action==='hole-left'?55:action==='hole-right'?245:150,y:32};render();}
});
app.addEventListener('input',event=>{if(event.target.id==='request'){state.draft=event.target.value;$('send').disabled=!state.draft.trim();}});
app.addEventListener('change',event=>{if(state.busy)return;if(event.target.name==='photo-owner'){state.gift=event.target.value==='recipient';$('gift-help').hidden=!state.gift;const checkout=app.querySelector('[data-action="checkout"]');if(checkout&&state.logged)checkout.textContent=state.gift?'테스트 구매하고 선물 준비하기':'테스트 구매하고 사진 채우기';}else if(event.target.id==='legacy-gift')state.gift=event.target.checked;});
app.addEventListener('pointerup',event=>{
 const box=event.target.closest('#placement');if(!box||state.busy)return;const bounds=box.getBoundingClientRect(),x=Math.max(32,Math.min(268,(event.clientX-bounds.left)/bounds.width*300)),y=Math.max(32,Math.min(268,(event.clientY-bounds.top)/bounds.height*300));
 const distances=[x-32,268-x,y-32,268-y],nearest=distances.indexOf(Math.min(...distances));state.hole={x:nearest===0?32:nearest===1?268:x,y:nearest===2?32:nearest===3?268:y};render();
});
for(const select of Object.values(options))select.addEventListener('change',reset);
$('restart').addEventListener('click',reset);$('recipient-demo').addEventListener('click',()=>{state.notice='';go('registration');});
window.addEventListener('pagehide',()=>{epoch++;clearTimeout(timer);clearTimeout(noticeTimer);});reset();
