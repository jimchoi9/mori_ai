return await(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),list=document.querySelector('.content-pages');window.scrollTo(0,0);await pause(35);
 const ids=()=>[...list.children].filter(n=>n.dataset.page).map(n=>n.dataset.page),before=ids(),row=list.querySelector('[data-page]'),photo=row.querySelector('.easy-photo-open');
 const point=(y)=>new Touch({identifier:71,target:photo,clientX:50,clientY:y,pageX:50,pageY:y+window.scrollY});
 const touch=(type,y)=>{const t=point(y);photo.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[t],changedTouches:[t]}));};
 const y=row.getBoundingClientRect().top+30;
 touch('touchstart',y);await pause(100);touch('touchmove',y+25);await pause(260);if(document.querySelector('.content-floating'))throw Error('scroll-intent press activated');touch('touchend',y+25);
 touch('touchstart',y);await pause(330);if(document.querySelector('.content-floating')!==row)throw Error('touch hold did not lift');touch('touchmove',520);await pause(30);touch('touchend',520);await pause(1000);
 if(ids().join()===before.join())throw Error('touch drop did not reorder');if(new Set(ids()).size!==20)throw Error('touch lost rows');
 return {touchReorder:true,scrollIntentCancelled:true,rows:ids().length,placeholderCleaned:!document.querySelector('.content-placeholder')};
})()
