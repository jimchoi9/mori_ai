/** Continuous pixel movement of loaded candidates; never fetches or swaps chips. */
export function startRotation(tick:(pixels:number)=>void, paused:()=>boolean,
  schedule: (callback:FrameRequestCallback)=>number = requestAnimationFrame,
  cancel:(id:number)=>void = cancelAnimationFrame) {
  let id:number, previous:number|undefined;
  const frame=(time:number)=>{
    const elapsed=previous===undefined?0:Math.min(time-previous,50);
    previous=time;
    if (!paused()) tick(elapsed*0.016); // 16 px / second; no jump after a background tab.
    id=schedule(frame);
  };
  id=schedule(frame);
  return ()=>cancel(id);
}

/** Move through a single, finite set without cloning candidates or jumping to the start. */
export function advanceStrip(position:number, max:number, pixels:number, direction:1|-1) {
  const next=Math.max(0,Math.min(max,position+pixels*direction));
  const atEdge=pixels>0 && (direction===1 ? next>=max : next<=0);
  return {position:next,direction:(atEdge?-direction:direction) as 1|-1,atEdge};
}
