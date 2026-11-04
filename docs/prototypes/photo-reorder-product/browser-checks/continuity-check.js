return await (async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),list=document.querySelector('.content-pages');
 const pointer=(type,y,target=window,id=41)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'mouse',pointerId:id,button:0,clientX:55,clientY:y}));
 const first=window.__reorderCheck.row;
 pointer('pointerup',525);await pause(45);
 if(list.children[2]!==first)throw Error('drop did not move to gap3');
 const next=list.querySelector('[data-page]'),photo=next.querySelector('.easy-photo-open'),y=next.getBoundingClientRect().top+35;
 pointer('pointerdown',y,photo,42);await pause(350);
 if(document.querySelector('.content-floating'))throw Error('second save must wait until first finishes');
 await pause(650);
 if(document.querySelector('.content-floating')!==next)throw Error('held next row did not resume on save acknowledgement');
 if(!next.isConnected||list.querySelector(`[data-page="${next.dataset.page}"]`)!==next)throw Error('acknowledgement replaced the held DOM row');
 pointer('pointermove',410,window,42);await pause(25);pointer('pointerup',410,window,42);await pause(1000);
 const actual=await (await fetch('/__demo/state')).json();
 if(actual.writes!==2)throw Error('two consecutive gestures did not create two saves: '+actual.writes);
 const ids=[...list.children].map(n=>n.dataset.page);if(ids.join()!==actual.ids.join())throw Error('visible order differs from acknowledged order');
 if(new Set(ids).size!==20)throw Error('photo missing or duplicated');
 return {consecutiveSaves:actual.writes,heldRowPreserved:true,rows:ids.length,toast:document.querySelector('.content-toast')?.textContent};
})()
