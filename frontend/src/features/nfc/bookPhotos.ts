import {photoLayout} from './photoLayout';
interface Photo {src:string;media:HTMLImageElement}
/** Matches photo decoration and late image loads to the reader's existing nearby lifetime. */
export function createBookPhotos(photos:Photo[]){
 let index=-2,alive=true;
 const visibleSize=()=>{
  for(const p of photos){const box=p.media.parentElement;if(box&&box.clientWidth>0&&box.clientHeight>0)return {width:box.clientWidth,height:box.clientHeight};}
  return null;
 };
 const layout=(p:Photo)=>{
  const box=p.media.parentElement;if(!box)return;
  const size=box.clientWidth>0&&box.clientHeight>0?{width:box.clientWidth,height:box.clientHeight}:visibleSize();
  if(!size)return;
  const plan=photoLayout(p.media.naturalWidth,p.media.naturalHeight,size.width,size.height);
  if(!plan)return;
  box.classList.toggle('story-portrait',plan.portrait);
  box.style.setProperty('--story-scale',String(plan.zoom));
 };
 const clear=(p:Photo)=>{
  p.media.removeAttribute('src');
  const box=p.media.parentElement;box?.style.removeProperty('--story-backdrop');box?.style.removeProperty('--story-scale');box?.classList.remove('story-portrait');
 };
 const listeners=photos.map((p,i)=>{
  const loaded=()=>{if(alive&&Math.abs(i-index)<=1)layout(p);};
  p.media.addEventListener('load',loaded);return loaded;
 });
 return {
  nearby(next:number){
   if(!alive)return;index=next;
   photos.forEach((p,i)=>{
    if(Math.abs(i-index)<=1){if(!p.media.getAttribute('src'))p.media.src=p.src;p.media.parentElement?.style.setProperty('--story-backdrop',`url("${p.src}")`);layout(p);}
    else clear(p);
   });
  },
  destroy(){alive=false;photos.forEach((p,i)=>{p.media.removeEventListener('load',listeners[i]);clear(p);});}
 };
}
