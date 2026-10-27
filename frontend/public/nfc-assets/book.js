// Selected from the user-provided Mori NFC prototype. See README.md for provenance.
window.createMemoryBook = (host, { reduced, chapters, onTurn, onPage }) => {
  host.classList.add('book-reader');
  host.innerHTML = '<div id="book-frame"></div><div class="book-position" aria-live="polite"></div>';
  const frame = host.querySelector('#book-frame'), position = host.querySelector('.book-position');
  let destroyed=false;
  let book, portrait, pageWidth, pageHeight, bookWidth, currentPage = 0;
  let gesture = null, hover = null, animating = false, idle = false;
  let idleTimer = 0, idleFrame = 0, finishFrame = 0, resizeTimer = 0, copyFrame = 0;
  const fitCopy=()=>{for(const copy of host.querySelectorAll(".story-copy")){if(!copy.clientHeight)continue;const text=copy.querySelector("p");text.style.fontSize="";text.style.lineHeight="";let size=parseFloat(getComputedStyle(text).fontSize);while(copy.scrollHeight>copy.clientHeight+1&&size>14){text.style.fontSize=(--size)+"px";text.style.lineHeight="1.5";}}};
  const scheduleCopy=()=>{cancelAnimationFrame(copyFrame);copyFrame=requestAnimationFrame(fitCopy);};
  const touchCapable = () => navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches || matchMedia('(hover: none)').matches;
  const clearIdle = () => {
    clearTimeout(idleTimer);cancelAnimationFrame(idleFrame);
    if (!idle || !book) return;
    idle = false;host.dataset.cornerHint = 'off';book.userMove({ x: -bookWidth, y: -1 }, false);book.getRender().finishAnimation();
  };
  const scheduleIdle = () => {
    if(destroyed)return;
    clearTimeout(idleTimer);
    if (!touchCapable() || currentPage === chapters.length-1) return;
    idleTimer = setTimeout(() => {
      if (gesture || hover || animating || idle || document.hidden) return;
      idle = true;host.dataset.cornerHint = reduced ? 'still' : 'breeze';
      book.userMove({ x: bookWidth - 2, y: pageHeight - 2 }, false);book.getRender().finishAnimation();
      if (reduced) {book.userMove({ x: bookWidth - 24, y: pageHeight - 30 }, false);return;}
      const started = performance.now();
      const sway = time => {
        if (!idle) return;
        const phase = Math.min(((time - started) % 4800) / 3600, 1), breeze = (1 - Math.cos(phase * Math.PI * 2)) / 2;
        book.userMove({ x: bookWidth - 1 - Math.min(48, pageWidth * .16) * breeze, y: pageHeight - 1 - 60 * breeze }, false);
        idleFrame = requestAnimationFrame(sway);
      };
      idleFrame = requestAnimationFrame(sway);
    }, 1500);
  };
  const page = (className, html) => {
    const element = document.createElement('div');element.className = 'book-page ' + className;element.innerHTML = html;return element;
  };
  function rebuild() {
    if(destroyed)return;
    clearIdle();cancelAnimationFrame(finishFrame);gesture = null;hover = null;animating = false;
    if (book) book.destroy();
    const width = host.clientWidth, height = Math.min(host.clientHeight, visualViewport?.height || innerHeight);
    portrait = height >= width;pageWidth = Math.floor(portrait ? width : Math.min(width / 2, height * .75));pageHeight = Math.floor(portrait ? height : pageWidth / .75);bookWidth = pageWidth * (portrait ? 1 : 2);
    host.classList.toggle('book-landscape', !portrait);
    frame.style.width = bookWidth + 'px';frame.style.height = pageHeight + 'px';
    const target = document.createElement('div');target.id = 'opening-book';frame.replaceChildren(target);
    const storyText = chapter => {const copy=document.createElement('div');copy.className='story-copy';const text=document.createElement('p');text.textContent=chapter.text;copy.append(text);return copy;};
    const stories = chapters.map(chapter => {
      const story=page('story-page','<div class="story-picture"></div>');
      chapter.media.className='story-image';story.querySelector('.story-picture').append(chapter.media);story.append(storyText(chapter));return story;
    });
    let pages=stories;
    if(!portrait)pages=stories.flatMap((story,index)=>{story.querySelector('.story-copy').remove();const words=page('story-page story-text-page','');words.append(storyText(chapters[index]));return [story,words];});
    target.append(...pages);
    book = new St.PageFlip(target, { width: pageWidth, height: pageHeight, size: 'fixed', startPage: currentPage * (portrait ? 1 : 2), usePortrait: portrait, showCover: false, useMouseEvents: false, mobileScrollSupport: true, showPageCorners: true, pageTurnInteractionZone: 'edges', pageTurnEdgeWidthRatio: .2, allowTapFlip: false, drawShadow: true, maxShadowOpacity: .3, flippingTime: reduced ? 1 : 600 });
    book.on('flip', event => {currentPage = Math.floor(event.data / (portrait ? 1 : 2));host.dataset.page = String(currentPage);position.textContent = (currentPage+1)+' / '+chapters.length;clearIdle();onPage(currentPage);scheduleCopy();});
    book.on('changeState', event => {host.dataset.bookState = event.data;animating = event.data === 'flipping';if (event.data === 'read') scheduleIdle();});
    book.on('init', scheduleIdle);book.loadFromHTML(pages);host.dataset.page = String(currentPage);host.dataset.bookReady = 'true';position.textContent = (currentPage+1)+' / '+chapters.length;onPage(currentPage);scheduleCopy();
  }
  const pointFor = event => {const rect = frame.getBoundingClientRect();return { x: event.clientX - rect.left, y: event.clientY - rect.top };};
  const continueFold = (end, target) => {
    animating = true;const started = performance.now();
    const finish = time => {
      const progress = reduced ? 1 : Math.min((time - started) / 140, 1), point = { x: end.x + (target - end.x) * progress, y: end.y };
      book.userMove(point, true);
      if (progress < 1) finishFrame = requestAnimationFrame(finish);
      else {animating = false;book.userStop(point, false);}
    };
    finishFrame = requestAnimationFrame(finish);
  };
  const clearHover = () => {const active = hover;hover = null;if (active) continueFold(active.point, active.backward ? -1 : bookWidth + 1);};
  frame.addEventListener('pointerdown', event => {
    clearIdle();
    if (gesture || animating || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const start = pointFor(event), backward = portrait ? start.x <= pageWidth * .4 : start.x < pageWidth;
    if ((backward && currentPage === 0) || (!backward && currentPage === chapters.length-1)) return;
    hover = null;gesture = { id: event.pointerId, start, last: start, dragging: false, backward, started: performance.now(), distance: 0 };
    frame.setPointerCapture(event.pointerId);event.preventDefault();book.startUserTouch(start);
  });
  frame.addEventListener('pointermove', event => {
    const point = pointFor(event);
    if (!gesture) {
      if (event.pointerType !== 'mouse' || event.buttons !== 0 || animating || !matchMedia('(any-hover: hover)').matches) return;
      if (!portrait) {book.userMove(point, false);return;}
      const backward = point.x < pageWidth / 2, nearEdge = point.x > 0 && point.x < bookWidth && point.y > 0 && point.y < pageHeight && (point.x <= pageWidth * .2 || point.x >= pageWidth * .8);
      if (!nearEdge || (backward && currentPage === 0) || (!backward && currentPage === chapters.length-1)) {clearHover();return;}
      if (hover && hover.backward !== backward) {clearHover();return;}
      if (!hover) book.startUserTouch({ x: backward ? -8 : bookWidth + 8, y: point.y });
      hover = { point, backward };book.userMove(point, true);return;
    }
    if (gesture.id !== event.pointerId) return;
    gesture.distance = Math.max(gesture.distance, Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y));
    if (!gesture.dragging && Math.abs(point.x - gesture.start.x) < 10) return;
    gesture.dragging = true;gesture.last = point;book.userMove(point, true);event.preventDefault();
  });
  frame.addEventListener('pointerleave', () => {if (!gesture && !animating) {if (portrait) clearHover();else book.userMove({ x: -bookWidth, y: -1 }, false);}});
  const finishGesture = (event, cancelled = false) => {
    const active = gesture;
    if (!active || active.id !== event.pointerId) return;
    gesture = null;
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    const end = cancelled ? active.last : pointFor(event), middle = portrait ? pageWidth / 2 : pageWidth, complete = !cancelled && (active.backward ? end.x >= middle : end.x <= middle);
    const distance = Math.max(active.distance, Math.hypot(end.x - active.start.x, end.y - active.start.y));
    const tap = !cancelled && !active.dragging && distance <= 10 && performance.now() - active.started <= 350 && end.x >= 0 && end.x <= bookWidth && end.y >= 0 && end.y <= pageHeight;
    if (tap) {
      book.userStop(end, true);onTurn(currentPage+(active.backward?-1:1));
      if (active.backward) book.flipPrev('bottom');else book.flipNext('bottom');
      return;
    }
    if(complete && active.dragging)onTurn(currentPage+(active.backward?-1:1));
    if (active.dragging && (cancelled || (portrait && ((active.backward && !complete) || (!active.backward && complete))))) continueFold(end, cancelled && !active.backward ? bookWidth + 1 : -1);
    else book.userStop(end, false);
    scheduleIdle();
  };
  frame.addEventListener('pointerup', event => finishGesture(event));frame.addEventListener('pointercancel', event => finishGesture(event, true));
  const resize = () => {clearTimeout(resizeTimer);resizeTimer = setTimeout(rebuild, 120);};
  addEventListener('resize', resize);visualViewport?.addEventListener('resize', resize);
  const visibility=()=>{if(document.hidden)clearIdle();else scheduleIdle();};
  document.addEventListener('visibilitychange',visibility);
  const turn=offset=>{if(animating)return;const target=currentPage+offset;if(target<0||target>=chapters.length)return;clearIdle();onTurn(target);if(offset<0)book.flipPrev('bottom');else book.flipNext('bottom');};
  const key=event=>{if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();turn(event.key==='ArrowRight'?1:-1);}};
  addEventListener('keydown',key);
  rebuild();
  return {destroy(){destroyed=true;clearIdle();clearTimeout(idleTimer);clearTimeout(resizeTimer);cancelAnimationFrame(finishFrame);cancelAnimationFrame(copyFrame);removeEventListener('resize',resize);visualViewport?.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);removeEventListener('keydown',key);book?.destroy();host.replaceChildren();}};
};
