const reader=document.querySelector('.reader'),description=document.querySelector('#description');
const descriptions={plain:'추천안 · 사진과 글을 함께 모으고, 여백은 앨범 배경색으로 둡니다.',blur:'사진 전체는 같고, 남는 공간에 같은 사진을 흐리게 깔아 둡니다.',crop:'현재 NFC 뷰어의 75% 사진 영역 + 가운데 채우기 배치를 비교합니다. 좌우가 잘립니다.'};
document.querySelectorAll('[data-mode][aria-pressed]').forEach(button=>button.addEventListener('click',()=>{reader.dataset.mode=button.dataset.mode;description.textContent=descriptions[button.dataset.mode];document.querySelectorAll('[aria-pressed]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}));
const back=document.querySelector('#show-controls');
document.querySelector('#preview').onclick=()=>{document.body.classList.add('preview');back.hidden=false;window.scrollTo(0,0);back.focus({preventScroll:true});};
back.onclick=()=>{document.body.classList.remove('preview');back.hidden=true;document.querySelector('#preview').focus({preventScroll:true});};
const dialog=document.querySelector('#lightbox'),canvas=document.querySelector('#canvas'),photo=document.querySelector('#zoom-photo'),level=document.querySelector('#zoom-level');
let scale=1,x=0,y=0,baseW=0,baseH=0,gesture=null;const pointers=new Map();
const clamp=(v,limit)=>Math.max(-limit,Math.min(limit,v));
function draw(){const maxX=Math.max(0,(baseW*scale-canvas.clientWidth)/2),maxY=Math.max(0,(baseH*scale-canvas.clientHeight)/2);x=clamp(x,maxX);y=clamp(y,maxY);photo.style.width=baseW+'px';photo.style.height=baseH+'px';photo.style.transform=`translate(${-baseW*scale/2+x}px,${-baseH*scale/2+y}px) scale(${scale})`;level.textContent=Number(scale.toFixed(1))+'×';document.querySelector('#zoom-out').disabled=scale<=1;document.querySelector('#zoom-in').disabled=scale>=5;}
function fit(){const aspect=photo.naturalWidth/photo.naturalHeight||2048/1153;baseW=Math.min(canvas.clientWidth,canvas.clientHeight*aspect);baseH=baseW/aspect;scale=1;x=y=0;pointers.clear();gesture=null;draw();}
function zoom(value){scale=Math.max(1,Math.min(5,value));draw();}
document.querySelector('#open-photo').onclick=()=>{dialog.showModal();fit();document.querySelector('#close-photo').focus();};
document.querySelector('#close-photo').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{pointers.clear();gesture=null;document.querySelector('#open-photo').focus({preventScroll:true});});
document.querySelector('#zoom-in').onclick=()=>zoom(scale+.5);document.querySelector('#zoom-out').onclick=()=>zoom(scale-.5);document.querySelector('#reset').onclick=fit;
photo.onload=()=>{if(dialog.open)fit();};document.querySelector('.photo').onerror=()=>{document.querySelector('#photo-error').hidden=false;document.querySelector('#open-photo').disabled=true;};
function rebase(){const points=[...pointers.values()];if(!points.length){gesture=null;return;}const a=points[0],b=points[1];gesture={x,y,scale,mx:b?(a.x+b.x)/2:a.x,my:b?(a.y+b.y)/2:a.y,distance:b?Math.hypot(a.x-b.x,a.y-b.y):0};}
canvas.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);rebase();});
canvas.addEventListener('pointermove',event=>{if(!pointers.has(event.pointerId)||!gesture)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const [a,b]=pointers.values();if(b&&gesture.distance){const next=Math.max(1,Math.min(5,gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.distance)),rect=canvas.getBoundingClientRect(),mx=(a.x+b.x)/2,my=(a.y+b.y)/2,ratio=next/gesture.scale;scale=next;x=mx-rect.left-rect.width/2-(gesture.mx-rect.left-rect.width/2-gesture.x)*ratio;y=my-rect.top-rect.height/2-(gesture.my-rect.top-rect.height/2-gesture.y)*ratio;}else{x=gesture.x+a.x-gesture.mx;y=gesture.y+a.y-gesture.my;}draw();});
function end(event){pointers.delete(event.pointerId);rebase();}canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
canvas.addEventListener('dblclick',()=>{if(scale>1)fit();else zoom(2);});
canvas.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(event.key)){event.preventDefault();if(event.key==='ArrowLeft')x+=60;if(event.key==='ArrowRight')x-=60;if(event.key==='ArrowUp')y+=60;if(event.key==='ArrowDown')y-=60;if(event.key==='+'||event.key==='=')zoom(scale+.5);if(event.key==='-')zoom(scale-.5);if(event.key==='0')fit();draw();}});
addEventListener('resize',()=>{if(dialog.open)fit();});
