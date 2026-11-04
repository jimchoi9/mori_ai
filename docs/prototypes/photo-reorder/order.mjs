/** A slot is the insertion index in the list after removing the lifted photo. */
export function insertAt(ids,id,slot){
 const rest=ids.filter(value=>value!==id);if(rest.length===ids.length||!Number.isInteger(slot)||slot<0||slot>rest.length)return [...ids];rest.splice(slot,0,id);return rest;
}
export function slotAt(centres,y){const at=centres.findIndex(mid=>y<mid);return at<0?centres.length:at;}
export function scrollDelta(y,top,bottom){const edge=65;if(y<top+edge)return -Math.min(14,Math.max(0,(top+edge-y)/edge)*14);if(y>bottom-edge)return Math.min(14,Math.max(0,(y-bottom+edge)/edge)*14);return 0;}

export function restoreManual(ids,remembered){const present=new Set(ids),seen=new Set();return [...remembered,...ids].filter(id=>{if(!present.has(id)||seen.has(id))return false;seen.add(id);return true;});}
