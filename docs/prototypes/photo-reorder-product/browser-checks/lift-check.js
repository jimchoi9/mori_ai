return await (async()=>{
 const list=document.querySelector('.content-pages'),rows=[...list.children],row=rows[0],photo=row.querySelector('.easy-photo-open'),r=row.getBoundingClientRect();
 window.__reorderCheck={ids:rows.map(n=>n.dataset.page),row,photo};
 photo.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',pointerId:41,button:0,clientX:r.left+35,clientY:r.top+35}));
 await new Promise(r=>setTimeout(r,350));
 if(!row.classList.contains('content-floating'))throw Error('held photo did not activate');
 window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',pointerId:41,clientX:55,clientY:525}));
 await new Promise(r=>setTimeout(r,40));
 const gap=list.querySelector('.content-placeholder');
 if(!gap||gap.offsetHeight<80)throw Error('missing full-size insertion slot');
 if([...list.children].filter(n=>n.dataset.page).some((n,i)=>n!==rows[i]))throw Error('source row DOM order changed during lift');
 return {lifted:true,slot:gap.dataset.slot,sourcePreserved:row===list.querySelector('[data-page]'),top:row.getBoundingClientRect().top};
})()
