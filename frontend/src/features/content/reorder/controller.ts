import {createHold} from './hold';
import {insertionSlot,scrollDelta} from './order';
export interface ReorderOptions {
 ids:string[];allowed:()=>boolean;blocked:()=>boolean;
 phase:(interacting:boolean,dragging:boolean)=>void;arm:()=>void;
 drop:(id:string,before:string|null)=>void;handleTap:(id:string)=>void;
}
type Press={row:HTMLElement;handle:boolean;x:number;y:number;lastY:number;scrollY:number;kind:'touch'|'pointer';pointer:number;moved:boolean;hold:ReturnType<typeof createHold>|null};
type Lift=Press&{id:string;placeholder:HTMLElement;slot:number;offsetY:number;viewportWidth:number;lastTime:number;styles:Record<string,string>};
/** React-owned rows keep their DOM order; only a temporary empty slot moves. */
export function createPhotoReorder(list:HTMLOListElement,options:()=>ReorderOptions){
 let pending:Press|null=null,active:Lift|null=null,frame=0,signature=options().ids.join(','),disposed=false;
 let swallow:{id:string;until:number}|null=null;
 const listeners:(()=>void)[]=[];
 const on=(target:EventTarget,type:string,fn:EventListener,opts?:AddEventListenerOptions)=>{target.addEventListener(type,fn,opts);listeners.push(()=>target.removeEventListener(type,fn,opts));};
 const rows=()=>Array.from(list.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&!!node.dataset.page);
 const clear=()=>{pending?.hold?.cancel();pending=null;};
 const reset=()=>{clear();cancelAnimationFrame(frame);if(active){const a=active;active=null;a.placeholder.remove();a.row.classList.remove('content-floating');for(const [key,value] of Object.entries(a.styles))a.row.style.setProperty(key,value);}options().phase(false,false);};
 const source=(target:EventTarget|null)=>{
  if(!(target instanceof Element))return null;
  const row=target.closest<HTMLElement>('li[data-page]');if(!row||row.parentElement!==list)return null;
  if(target.closest('.content-handle'))return {row,handle:true};
  if(target.closest('textarea,input,select,label,.content-remove,.content-move-options,[contenteditable]'))return null;
  const button=target.closest('button');if(button&&!button.classList.contains('easy-photo-open'))return null;
  return {row,handle:false};
 };
 const nextFlow=(node:Element)=>{let next=node.nextElementSibling;while(next===active?.row)next=next.nextElementSibling;return next;};
 const updateSlot=()=>{
  if(!active)return;const a=active,others=rows().filter(row=>row!==a.row),top=list.getBoundingClientRect().top;
  const slot=insertionSlot(others.map(row=>top+row.offsetTop+row.offsetHeight/2),a.lastY),before=others[slot]??null;
  if(nextFlow(a.placeholder)!==before){const positions=new Map(others.map(row=>[row,row.offsetTop]));list.insertBefore(a.placeholder,before);if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const row of others){const delta=positions.get(row)!-row.offsetTop;if(delta&&row.animate){row.getAnimations().forEach(animation=>animation.cancel());row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:160,easing:'ease-out'});}}}
  a.slot=slot;a.placeholder.dataset.slot=`${slot+1}번째 자리 · 여기에 놓기`;
 };
 const tick=(time:number)=>{
  if(!active)return;const a=active,elapsed=Math.min(32,a.lastTime?time-a.lastTime:16);a.lastTime=time;
  const footer=document.querySelector('.content-footer'),bottom=footer?Math.min(innerHeight,footer.getBoundingClientRect().top):innerHeight,delta=scrollDelta(a.lastY,55,bottom)*elapsed/16;
  if(delta){const max=Math.max(0,document.documentElement.scrollHeight-innerHeight);window.scrollTo(0,Math.max(0,Math.min(max,window.scrollY+delta)));}
  a.row.style.top=(a.lastY-a.offsetY-6)+'px';updateSlot();frame=requestAnimationFrame(tick);
 };
 const lift=()=>{
  if(!pending||options().blocked())return;const p=pending;clear();if(!p.row.isConnected)return reset();
  const rect=p.row.getBoundingClientRect(),placeholder=document.createElement('li');placeholder.className='content-placeholder';placeholder.style.height=rect.height+'px';placeholder.setAttribute('aria-hidden','true');
  const styles=Object.fromEntries(['left','top','width','height'].map(key=>[key,p.row.style.getPropertyValue(key)]));
  list.insertBefore(placeholder,p.row);p.row.classList.add('content-floating');Object.assign(p.row.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
  active={...p,id:p.row.dataset.page!,placeholder,slot:options().ids.indexOf(p.row.dataset.page!),offsetY:p.y-rect.top,viewportWidth:innerWidth,lastTime:0,styles};options().phase(true,true);updateSlot();frame=requestAnimationFrame(tick);
 };
 const arm=(target:EventTarget|null,x:number,y:number,kind:Press['kind'],pointer:number)=>{
  if(disposed||pending||active||!options().allowed())return;const found=source(target);if(!found)return;
  options().arm();signature=options().ids.join(',');pending={...found,x,y,lastY:y,scrollY:window.scrollY,kind,pointer,moved:false,hold:null};options().phase(true,false);
  if(!found.handle){const p=pending;p.hold=createHold(()=>options().blocked(),()=>{if(pending===p)lift();});}
 };
 const move=(x:number,y:number)=>{if(active){active.lastY=y;return;}if(!pending)return;pending.lastY=y;const distance=Math.hypot(x-pending.x,y-pending.y);if(pending.handle&&distance>5){pending.moved=true;lift();}else if(!pending.handle&&distance>10)reset();};
 const drop=(y:number)=>{
  if(!active)return;active.lastY=y;updateSlot();const a=active,others=rows().filter(row=>row!==a.row),before=others[a.slot]?.dataset.page??null;
  const ids=options().ids,rest=ids.filter(id=>id!==a.id),next=[...rest];next.splice(before===null?next.length:next.indexOf(before),0,a.id);swallow={id:a.id,until:performance.now()+700};reset();if(next.some((id,i)=>id!==ids[i]))options().drop(a.id,before);
 };
 on(list,'pointerdown',((e:PointerEvent)=>{if(e.pointerType!=='touch'&&e.button===0)arm(e.target,e.clientX,e.clientY,'pointer',e.pointerId);}) as EventListener);
 on(window,'pointermove',((e:PointerEvent)=>{const p=active??pending;if(p?.kind==='pointer'&&p.pointer===e.pointerId)move(e.clientX,e.clientY);}) as EventListener);
 on(window,'pointerup',((e:PointerEvent)=>{const p=active??pending;if(p?.kind==='pointer'&&p.pointer===e.pointerId){if(active)drop(e.clientY);else reset();}}) as EventListener);
 on(window,'pointercancel',((e:PointerEvent)=>{if((active??pending)?.kind==='pointer'&&(active??pending)?.pointer===e.pointerId)reset();}) as EventListener);
 on(list,'touchstart',((e:TouchEvent)=>{if(e.touches.length!==1){reset();return;}if(source(e.target)?.handle)e.preventDefault();const t=e.changedTouches[0];arm(e.target,t.clientX,t.clientY,'touch',t.identifier);}) as EventListener,{passive:false});
 on(list,'touchmove',((e:TouchEvent)=>{const p=active??pending;if(p?.kind!=='touch')return;const t=Array.from(e.touches).find(t=>t.identifier===p.pointer);if(t){if(active||p.handle)e.preventDefault();move(t.clientX,t.clientY);}}) as EventListener,{passive:false});
 on(list,'touchend',((e:TouchEvent)=>{const p=active??pending;if(p?.kind!=='touch')return;const t=Array.from(e.changedTouches).find(t=>t.identifier===p.pointer);if(!t)return;if(active){e.preventDefault();drop(t.clientY);}else{const handle=p.handle,id=p.row.dataset.page!;reset();if(handle){e.preventDefault();swallow={id,until:performance.now()+700};if(!options().blocked())options().handleTap(id);}}}) as EventListener,{passive:false});
 on(list,'touchcancel',()=>{if((active??pending)?.kind==='touch')reset();});
 on(window,'touchstart',((e:TouchEvent)=>{if(e.touches.length>1)reset();}) as EventListener,{passive:true});
 on(window,'scroll',()=>{if(pending&&!pending.handle&&Math.abs(window.scrollY-pending.scrollY)>3)reset();},{passive:true});
 on(list,'contextmenu',e=>{if(source(e.target))e.preventDefault();});
 on(list,'click',e=>{const target=e.target;if(!(target instanceof Element))return;const id=target.closest<HTMLElement>('[data-page]')?.dataset.page;if(active||swallow&&id===swallow.id&&performance.now()<swallow.until&&target.closest('.easy-photo-open,.content-handle')){e.preventDefault();e.stopPropagation();swallow=null;}},{capture:true});
 on(window,'keydown',((e:KeyboardEvent)=>{if(e.key==='Escape'&&(active||pending)){e.preventDefault();reset();}}) as EventListener);
 on(window,'resize',()=>{if(active&&Math.abs(innerWidth-active.viewportWidth)>4)reset();});
 on(window,'blur',reset);on(window,'pagehide',reset);on(window,'mori:logout',reset);on(window,'mori:session-expired',reset);on(document,'visibilitychange',()=>{if(document.hidden)reset();});
 return {sync(){if((active||pending)&&signature!==options().ids.join(','))reset();else if(!options().allowed())reset();else if(pending?.handle&&pending.moved)lift();else pending?.hold?.resume();},stop:reset,dispose(){disposed=true;reset();listeners.forEach(remove=>remove());}};
}
