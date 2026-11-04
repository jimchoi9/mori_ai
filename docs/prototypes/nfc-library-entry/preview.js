import {createBookPhotos} from './bookPhotos.mjs';

const root=document.querySelector('#root');
const samples=[
 {src:'photos/photo-1.webp',text:'함께 걸으며 이야기를 나눴다.'},
 {src:'photos/photo-2.webp',text:'바다 앞에서 잠시 쉬었다.'},
 {src:'photos/photo-3.webp',text:'오랜만에 모여 사진을 남겼다.'},
];
// Only the visitor's own two fictional albums exist in this collection.
const mine=[{id:'my-spring',title:'내가 담은 봄날',photos:[samples[0],samples[1]]},{id:'my-day',title:'나의 작은 일상',photos:[samples[2]]}];
const shared={id:'shared-book',title:'건네받은 추억',photos:[samples[1],samples[2],samples[0]]};
let signedIn=false,entry='nfc',cleanup=()=>{},version=0;
const progress=new Map(),scrolls=new Map();let currentPath='';
const path=()=>location.hash.slice(1)||'/';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function bar(){return '<aside class="trial-bar"><p>감상 후 연결 체험 · 예시 앨범만 사용해요.</p><a href="#/">체험 처음으로</a></aside>';}
function header(){return `<header class="mori-site-header"><a class="mori-home-brand" href="#/albums" aria-label="Mori · 내 앨범"><span class="mori-home-mark" aria-hidden="true">m</span><span>Mori</span></a>${signedIn?'<span class="trial-account" aria-label="체험 방문자 본인 계정">나</span>':''}</header>`;}
function intro(){return '<section class="trial-intro"><h1>책을 다 본 다음에는</h1><p>마지막 사진에서 한 장 더 넘겨보세요. 감상 중에는 내 앨범 버튼이 보이지 않습니다.</p><div class="trial-scenarios"><button type="button" data-entry="albums">내 앨범에서 열기</button><button type="button" data-entry="nfc-signed">NFC로 열기 · 로그인된 상태</button><button type="button" data-entry="nfc-guest">NFC로 열기 · 로그인하지 않은 상태</button></div></section>';}
function shelf(){return `<section class="bookshelf-screen"><header class="mori-screen-header"><div><h1>내 앨범</h1></div></header><p class="trial-source-note">지금 보고 있는 목록은 방문자 ‘나’의 예시 앨범입니다.</p><div class="books">${mine.map(album=>`<article class="album-card"><a class="album-card-link" href="#/read/${album.id}" data-open="${album.id}"><div class="album-card-cover"><div class="cover"><img src="${album.photos[0].src}" alt="${escape(album.title)} 표지"></div></div><h2>${escape(album.title)}</h2><p class="album-card-meta"><span>사진 ${album.photos.length}장</span></p></a></article>`).join('')}</div></section>`;}
function login(){return '<section class="trial-login"><h1>내 앨범 보기</h1><p>내 앨범을 보려면 로그인해 주세요.</p><p class="trial-source-note">로그인 동선만 보여주는 체험입니다. 실제 계정이나 비밀번호는 입력하지 않습니다.</p><button type="button" data-login>체험 계정으로 로그인</button><a href="#/read/shared-book" data-return-book>책으로 돌아가기</a></section>';}

async function reader(album,token){
 root.innerHTML='<div class="nfc-experience"><div class="nfc-reader" aria-label="추억책"></div></div>';
 const chapters=await Promise.all(album.photos.map(async photo=>{const media=new Image();media.src=photo.src;await media.decode();return {text:photo.text,src:media.src,media};}));
 if(token!==version)return;
 const photos=createBookPhotos(chapters);let book;
 const ending=part=>{
  const content=document.createElement('div');content.className='book-end-content';
  if(part!=='actions'){
   const mark=document.createElement('span');mark.className='book-end-mark';mark.setAttribute('aria-hidden','true');mark.textContent='m';
   const title=document.createElement('h2');title.textContent=album.title;content.append(mark,title);
  }
  if(part!=='cover'){
   const buttons=document.createElement('div');buttons.className='book-end-buttons';
   const again=document.createElement('button');again.type='button';again.textContent='다시 보기';again.dataset.again='';again.addEventListener('click',()=>book.first());
   const library=document.createElement('a');library.href='#/albums';library.textContent='내 앨범 보기 →';library.dataset.library='';
   buttons.append(again,library);content.append(buttons);
  }
  return content;
 };
 const page=index=>{progress.set(album.id,index);photos.nearby(Math.min(index,chapters.length-1));};
 book=window.createMemoryBook(root.querySelector('.nfc-reader'),{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,ending,startIndex:progress.get(album.id)||0,onTurn:index=>photos.nearby(Math.min(index,chapters.length-1)),onPage:page});
 cleanup=()=>{photos.destroy();book.destroy();};
}

function render(){
 cleanup();cleanup=()=>{};const token=++version,current=path(),match=current.match(/^\/read\/([^/]+)$/);
 const album=match&&(match[1]===shared.id?shared:mine.find(item=>item.id===match[1]));
 if((current==='/albums'||album&&album.id!==shared.id)&&!signedIn){location.replace(location.pathname+'#/login');return;}
 document.body.classList.toggle('nfc-mode',!!album);
 if(album){void reader(album,token).catch(()=>{root.textContent='사진을 다시 불러와 주세요.';});return;}
 root.innerHTML=bar()+`<main id="main-content">${header()}${current==='/albums'?shelf():current==='/login'?login():intro()}</main>`;
 root.querySelectorAll('[data-entry]').forEach(button=>button.addEventListener('click',()=>{
  const scenario=button.dataset.entry;entry=scenario==='albums'?'albums':'nfc';signedIn=scenario!=='nfc-guest';
  if(entry==='albums')location.hash='/albums';else{progress.set(shared.id,0);location.hash='/read/'+shared.id;}
 }));
 root.querySelectorAll('[data-open]').forEach(link=>link.addEventListener('click',()=>{progress.set(link.dataset.open,0);}));
 root.querySelector('[data-login]')?.addEventListener('click',()=>{signedIn=true;location.replace(location.pathname+'#/albums');});
 requestAnimationFrame(()=>scrollTo(0,scrolls.get(current)||0));
}
addEventListener('hashchange',()=>{scrolls.set(currentPath,scrollY);currentPath=path();render();});
currentPath=path();render();
