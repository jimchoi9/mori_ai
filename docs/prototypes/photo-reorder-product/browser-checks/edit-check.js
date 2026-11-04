return await(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),list=document.querySelector('.content-pages'),ids=()=>[...list.children].filter(n=>n.dataset.page).map(n=>n.dataset.page);
 document.querySelector('.content-edit').click();await pause(35);
 const first=list.querySelector('[data-page]'),handle=first.querySelector('.content-handle'),before=ids();handle.click();await pause(30);
 if(!first.querySelector('.content-move-options'))throw Error('handle tap menu missing');
 const textarea=first.querySelector('textarea');textarea.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'내가 남긴 글귀');textarea.dispatchEvent(new Event('input',{bubbles:true}));await pause(20);
 handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await pause(1900);
 if(ids()[1]!==before[0])throw Error('keyboard did not move first row down');
 const moved=list.querySelector(`[data-page="${before[0]}"]`);if(moved.querySelector('textarea').value!=='내가 남긴 글귀')throw Error('caption draft was lost');
 if(document.querySelector('.content-finish').textContent!=='저장하고 완료')throw Error('edit completion label lost changed-session state');
 const authoritative=ids();await fetch('/__demo/fail',{method:'POST'});
 moved.querySelector('.content-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await pause(1100);
 if(ids().join()!==authoritative.join())throw Error('failed save did not restore authoritative order');
 if(!document.querySelector('[role="alert"]'))throw Error('failed save has no error');
 return {handleMenu:true,keyboardMove:true,captionPreserved:true,saveFailureRestored:true,completion:document.querySelector('.content-finish').textContent};
})()
