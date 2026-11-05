import {createBookPhotos} from './bookPhotos.mjs';
import {createBookEnding,readBookPosition,rememberBookPosition} from './bookEnding.mjs';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function message(root,title,text){document.body.classList.remove('nfc-mode');root.innerHTML=`<main class="recipient-message"><span class="mori-home-mark" aria-hidden="true">m</span><h1>${escape(title)}</h1><p>${escape(text)}</p><button data-reload>다시 불러오기</button><p class="visitor-sample-note">체험용 앨범 · 실제 사진이나 계정은 사용하지 않아요.</p></main>`;root.querySelector('[data-reload]').addEventListener('click',()=>location.reload());}
export async function openBook(root,data,{libraryHref='/albums',isCurrent=()=>true}={}){
 if(data.state==='paused'){message(root,'공유를 잠시 쉬고 있어요.','앨범을 공유한 사람이 다시 켜면 같은 링크로 감상할 수 있어요.');return()=>{};}
 if(data.state!=='ready'){message(root,'추억을 담고 있어요.','사진 저장이 끝나면 같은 링크에서 감상할 수 있어요.');return()=>{};}
 const controller=new AbortController(),urls=[],chapters=new Array(data.pages.length);
 document.body.classList.add('nfc-mode');root.innerHTML='<section class="nfc-experience"><div class="nfc-loading"><div class="nfc-intro"><small>MORI</small><h1>추억책을 열고 있어요.</h1><p>사진과 글을 불러오는 중이에요.</p></div></div></section>';
 let index=0;
 const lane=async()=>{for(;;){const i=index++;if(i>=data.pages.length)return;const page=data.pages[i];const response=await fetch(page.src,{credentials:'omit',headers:{'X-Demo-Viewer':data.session_token},signal:controller.signal});if(!response.ok)throw Error('MEDIA_UNAVAILABLE');const src=URL.createObjectURL(await response.blob());urls.push(src);const media=new Image();media.src=src;await media.decode();chapters[i]={src,media,text:page.text};}};
 try{await Promise.all(Array.from({length:Math.min(4,data.pages.length)},lane));}
 catch{controller.abort();urls.forEach(URL.revokeObjectURL);if(!isCurrent())return()=>{};message(root,'사진을 불러오지 못했어요.','잠시 후 다시 열어 주세요.');return()=>{};}
 if(!isCurrent()){controller.abort();urls.forEach(URL.revokeObjectURL);return()=>{};}
 root.innerHTML='<section class="nfc-experience"><div class="nfc-reader" aria-label="추억책"></div></section>';
 const host=root.querySelector('.nfc-reader'),photos=createBookPhotos(chapters);
 let book;
 const factory=createBookEnding(data.album_title,()=>book.first());
 const ending=part=>{const node=factory(part);const link=node.querySelector('a');if(link)link.href=libraryHref;return node;};
 book=window.createMemoryBook(host,{reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,chapters,ending,startIndex:readBookPosition(chapters.length),onTurn:i=>photos.nearby(Math.min(i,chapters.length-1)),onPage:i=>{photos.nearby(Math.min(i,chapters.length-1));rememberBookPosition(i);}});
 return()=>{controller.abort();photos.destroy();book.destroy();urls.forEach(URL.revokeObjectURL);document.body.classList.remove('nfc-mode');};
}
async function boot(){
 const root=document.querySelector('#root');if(!root)return;
 if(location.pathname==='/albums'){
  const logged=sessionStorage.getItem('mori:trial-visitor-login')==='true';
  root.innerHTML=`<main class="visitor-library"><span class="eyebrow">방문자 계정 체험</span><h1>${logged?'내 앨범':'내 앨범 보기'}</h1><p>${logged?'이곳은 방문자 자신의 목록이에요. 방금 감상한 책 주인의 다른 앨범은 보이지 않아요.':'내 앨범을 보려면 로그인해 주세요. 공유받은 책은 로그인 없이 감상할 수 있어요.'}</p>${logged?'<div class="cover"><img src="/assets/photo-2.svg" alt="방문자 자신의 예시 앨범"></div><h2>나의 첫 기억 · 방문자 예시</h2>':'<button data-login>체험: 로그인하고 내 앨범 보기</button>'}<p class="demo-note">실제 로그인은 하지 않는 체험 화면입니다.</p></main>`;
  root.querySelector('[data-login]')?.addEventListener('click',()=>{sessionStorage.setItem('mori:trial-visitor-login','true');location.reload();});return;
 }
 const id=location.pathname.match(/^\/nfc\/([^/]+)$/)?.[1];if(!id)return;
 if(new URLSearchParams(location.search).get('visitor')==='friend')sessionStorage.setItem('mori:trial-visitor-login','true');
 const key=new URLSearchParams(location.hash.slice(1)).get('key');
 try{
  const response=await fetch('/demo/enter',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,key})});
  if(!response.ok){message(root,'감상 링크를 확인해 주세요.','받은 주소 전체를 다시 열어 주세요.');return;}
  const data=await response.json();await openBook(root,data);
 }catch{message(root,'연결을 확인해 주세요.','네트워크 연결 후 다시 열어 주세요.');}
}
if(location.pathname==='/albums'||location.pathname.startsWith('/nfc/'))void boot();
