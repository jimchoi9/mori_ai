import {initialTitle,acceptAuto,rename,capturePeriod} from './policy.mjs';
const $=s=>document.querySelector(s),cases=await fetch('cases.json').then(r=>r.json()),report=await fetch('results.json').then(r=>r.json()),results=new Map(report.results.map(r=>[r.id,r]));
const states=new Map(cases.map(c=>[c.id,results.get(c.id)?.state==='completed'?acceptAuto(initialTitle(c),results.get(c.id)?.title):initialTitle(c)]));let item=cases.find(c=>c.id==='gijang');
for(const c of cases){const option=document.createElement('option');option.value=c.id;option.textContent=c.label;$('#scenario').append(option);}$('#scenario').value=item.id;
function render(){const state=states.get(item.id),date=capturePeriod(item),meta=[date,`사진 ${item.photo_count}장`].filter(Boolean).join(' · ');$('#title').textContent=$('#detail-title').textContent=state.title;$('#meta').textContent=$('#detail-meta').textContent=meta;$('#facts').textContent=item.captions.length?item.captions.join('\n'):'사진 내용 단서 없음';const other=cases.find(c=>c.id===(item.id==='repeat'?'gijang':'repeat'));$('#other-title').textContent=states.get(other.id).title;$('#other-meta').textContent=[capturePeriod(other),`사진 ${other.photo_count}장`].filter(Boolean).join(' · ');$('#back').textContent='‹ '+$('#label').value;$('#heading').textContent=$('#label').value;renderPhotos();}
function edit(){const state=states.get(item.id);$('#name').value=state.title;$('#error').textContent='';$('#dialog').showModal();$('#name').focus();$('#name').select();}
$('#scenario').onchange=e=>{item=cases.find(c=>c.id===e.target.value);$('#diagnostic').textContent='';render();};$('#label').onchange=render;
$('#rename-detail').onclick=edit;
$('#open').onclick=()=>{$('#list').hidden=true;$('#detail').hidden=false;};$('#back').onclick=()=>{$('#list').hidden=false;$('#detail').hidden=true;};
$('#cancel').onclick=()=>$('#dialog').close();$('#form').onsubmit=e=>{e.preventDefault();try{states.set(item.id,rename(states.get(item.id),$('#name').value));$('#dialog').close();render();}catch(error){$('#error').textContent=error.message;}};
$('#late').onclick=()=>{const before=states.get(item.id);const next=results.get(item.id)?.state==='completed'?acceptAuto(before,results.get(item.id)?.title):before;states.set(item.id,next);render();$('#diagnostic').textContent=before.origin==='manual'?'직접 정한 이름이 그대로 유지됐습니다.':'자동 제목은 한 번만 적용됩니다. 먼저 이름을 바꿔 보세요.';};
render();

$('#other-open').onclick=()=>{item=cases.find(c=>c.id===(item.id==='repeat'?'gijang':'repeat'));$('#scenario').value=item.id;render();$('#list').hidden=true;$('#detail').hidden=false;};
for(const c of cases){const p=document.createElement('p'),r=results.get(c.id);p.textContent=`${c.label}: ${r.first_title} → ${r.title}${r.state==='skipped'?'（자동 생성 안 함）':''}`;$('#comparisons').append(p);}

function renderPhotos(){const list=$('#photo-list');list.replaceChildren();for(let i=0;i<item.photo_count;i++){const row=document.createElement('article');row.className='photo-row';const thumb=document.createElement('div');thumb.className='photo-thumb tone-'+(i%3);thumb.setAttribute('aria-label','임시 사진');const text=document.createElement('p');text.textContent=item.captions[i]||'글을 준비하고 있어요';row.append(thumb,text);list.append(row);}}
if(new URLSearchParams(location.search).has('preview'))document.body.classList.add('preview');
