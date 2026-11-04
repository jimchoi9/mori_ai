/** Stable neighbouring IDs, rather than a stale numeric index, describe a drop. */
export function placeBefore(ids:string[],id:string,before:string|null):string[]|null{
 if(!ids.includes(id)||before===id||before!==null&&!ids.includes(before))return null;
 const next=ids.filter(value=>value!==id);next.splice(before===null?next.length:next.indexOf(before),0,id);return next;
}
export const sameOrder=(a:string[],b:string[])=>a.length===b.length&&a.every((id,i)=>id===b[i]);
export function projected<T extends {id:string}>(pages:T[],preview:string[]|null):T[]{
 if(!preview)return pages;
 const byId=new Map(pages.map(p=>[p.id,p])),seen=new Set(preview);
 return [...preview.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]),...pages.filter(p=>!seen.has(p.id))];
}
export const insertionSlot=(centres:number[],y:number)=>{const at=centres.findIndex(mid=>y<mid);return at<0?centres.length:at;};
export function scrollDelta(y:number,top:number,bottom:number){const edge=65;return y<top+edge?-Math.min(14,Math.max(0,(top+edge-y)/edge)*14):y>bottom-edge?Math.min(14,Math.max(0,(y-bottom+edge)/edge)*14):0;}
