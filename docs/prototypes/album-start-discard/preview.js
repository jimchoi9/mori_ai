import {createBookPhotos} from './bookPhotos.mjs';

const root = document.getElementById('root');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const samples = [
  {src:'photos/photo-1.webp', text:'건물 입구 앞에서 일행과 기념사진을 남겼다.'},
  {src:'photos/photo-2.webp', text:'둘러앉아 치킨을 먹었다.'},
  {src:'photos/photo-3.webp', text:'노트북과 간식이 놓인 테이블을 둘러봤다.'},
];
const albums = [
  {id:'evening', title:'함께한 저녁', date:'2026.10.25', photos:[{...samples[0]}, {...samples[1]}]},
  {id:'afternoon', title:'같은 테이블에 모여', date:'2026.10.26', photos:[{...samples[2]}, {...samples[1]}]},
];
let draft = null, cleanup = () => {}, version = 0, nextId = 0, notice = '', toastTimer;
const picks = new Set();
const path = () => decodeURIComponent(location.hash.slice(1)) || '/albums';
const find = id => albums.find(album => album.id === id) ?? (draft?.id === id ? draft : undefined);

function toast(message) {
  document.querySelector('.preview-toast')?.remove();
  const element = document.createElement('div');
  element.className = 'preview-toast';
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.append(element);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.remove(), 3000);
}

function header() {
  return '<header class="mori-site-header"><a class="mori-home-brand" href="#/albums" aria-label="Mori · 내 앨범"><span class="mori-home-mark" aria-hidden="true">m</span><span>Mori</span></a></header>';
}

function home() {
  return `<section class="bookshelf-screen"><header class="mori-screen-header"><div><h1>내 앨범</h1></div><div class="mori-header-trailing"><button class="album-create" data-create>＋ 새 앨범</button></div></header><div class="books">${albums.map(album => `
    <article class="album-card"><a class="album-card-link" href="#/albums/${album.id}/view" aria-label="${escape(album.title)} 감상하기"><div class="album-card-cover"><div class="cover"><img src="${album.photos[0].src}" alt="${escape(album.title)} 표지"></div></div><h2>${escape(album.title)}</h2><p class="album-card-meta">${album.date ? `<span>${album.date}</span>` : ''}<span>사진 ${album.photos.length}장</span></p></a><div class="album-card-menu"><a class="album-watch" href="#/albums/${album.id}/manage">사진 관리 <span aria-hidden="true">↗</span></a></div></article>`).join('')}</div></section>`;
}

function manage(album) {
  return `<section class="preview-management"><header><a href="#/albums" aria-label="내 앨범으로 돌아가기">‹</a><h1>${escape(album.title)}</h1>${album.photos.length ? `<a class="preview-view" href="#/albums/${album.id}/view">감상하기 ↗</a>` : ''}</header><p class="preview-caption-meta">사진 ${album.photos.length}장</p>${album.photos.length ? album.photos.map((photo, index) => `<div class="preview-photo-row"><img src="${photo.src}" alt="사진 ${index + 1}"><p>${escape(photo.text)}</p></div>`).join('') : '<div class="empty album-empty-state"><p>사진을 추가해 주세요</p></div>'}<div class="preview-bottom"><button class="preview-add" data-add="${album.id}">＋ 사진 추가</button><button class="preview-edit" disabled>편집</button></div></section>`;
}

function picker(album) {
  return `<section class="preview-management"><header><a href="#/albums/${album.id}/manage" aria-label="사진 선택 취소">‹</a><h1>사진 선택</h1></header><p class="preview-caption-meta">체험용 예시 사진입니다. 실제 서비스에서는 휴대폰의 사진 선택 창이 열립니다.</p><div class="preview-pick-grid">${samples.map((photo, index) => `<label class="preview-choice"><input type="checkbox" data-pick="${index}" aria-label="예시 사진 ${index + 1} 선택"><img src="${photo.src}" alt="예시 사진 ${index + 1}"><span>사진 ${index + 1}</span></label>`).join('')}</div><p class="preview-picked-count" data-picked-count>사진을 골라주세요.</p><div class="preview-bottom"><button class="preview-add" data-confirm="${album.id}" disabled>사진 추가</button></div></section>`;
}

async function reader(album, token) {
  root.innerHTML = '<div class="nfc-experience"><div class="nfc-reader" aria-label="추억책"></div></div>';
  const chapters = await Promise.all(album.photos.map(async photo => {
    const media = new Image();
    media.src = photo.src;
    await media.decode();
    return {text:photo.text, src:media.src, media};
  }));
  if (token !== version) return;
  const photos = createBookPhotos(chapters);
  const book = window.createMemoryBook(root.querySelector('.nfc-reader'), {
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, chapters,
    onTurn:index => photos.nearby(index), onPage:index => photos.nearby(index),
  });
  cleanup = () => { photos.destroy(); book.destroy(); };
}

function render() {
  cleanup();
  cleanup = () => {};
  const token = ++version, current = path();
  // Only this never-saved draft is abandoned. Existing albums are untouched.
  if (draft && current !== `/albums/${draft.id}/manage` && current !== `/pick/${draft.id}`) draft = null;
  const match = current.match(/^\/albums\/([^/]+)\/(view|manage)$/);
  const picking = current.match(/^\/pick\/([^/]+)$/);
  const album = find(match?.[1] ?? picking?.[1]);
  const book = !!album?.photos.length && match?.[2] === 'view';
  document.body.classList.toggle('nfc-mode', book);
  document.querySelector('.preview-toast')?.remove();
  if (book) {
    void reader(album, token).catch(() => toast('사진을 불러오지 못했어요. 뒤로 가서 다시 열어주세요.'));
    return;
  }
  root.innerHTML = '<aside class="preview-bar"><div class="preview-note"><p>새 앨범 시작 체험 · 사진을 담지 않고 나가면 목록에 남지 않아요.</p><p>예시 사진만 사용하며, 새로고침하면 처음으로 돌아갑니다.</p></div></aside>' + `<main id="main-content">${picking ? '' : header()}${current === '/albums' ? home() : album ? (picking ? picker(album) : manage(album)) : '<section class="preview-menu-target"><p>사진을 담지 않은 새 앨범은 남기지 않았어요.</p><a href="#/albums">내 앨범으로 돌아가기</a></section>'}</main>`;

  root.querySelector('[data-create]')?.addEventListener('click', () => {
    draft = {id:`new-${++nextId}`, title:'새 앨범', date:'', photos:[]};
    location.hash = `/albums/${draft.id}/manage`;
  });
  root.querySelector('[data-add]')?.addEventListener('click', event => {
    picks.clear();
    location.hash = `/pick/${event.currentTarget.dataset.add}`;
  });
  root.querySelectorAll('[data-pick]').forEach(input => input.addEventListener('change', () => {
    const index = Number(input.dataset.pick);
    if (input.checked) picks.add(index); else picks.delete(index);
    const button = root.querySelector('[data-confirm]');
    button.disabled = !picks.size;
    button.textContent = picks.size ? `사진 ${picks.size}장 추가` : '사진 추가';
    root.querySelector('[data-picked-count]').textContent = picks.size ? `${picks.size}장 선택했어요.` : '사진을 골라주세요.';
  }));
  root.querySelector('[data-confirm]')?.addEventListener('click', () => {
    if (!picks.size || !album) return;
    album.photos.push(...[...picks].sort().map(index => ({...samples[index]})));
    if (album === draft) { albums.unshift(album); draft = null; }
    picks.clear();
    notice = '예시 사진을 추가했어요. 실제 저장은 하지 않아요.';
    location.hash = `/albums/${album.id}/manage`;
  });
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

addEventListener('hashchange', () => {
  render();
  if (notice) { toast(notice); notice = ''; }
});
render();
