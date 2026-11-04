export const HOLD_MS=300;
/** A press can mature while saving; unlock resumes it only if the finger is still down. */
export function createHold({blocked,activate,setTimer=setTimeout,clearTimer=clearTimeout}){
 let pressed=true,elapsed=false;
 const resume=()=>{if(pressed&&elapsed&&!blocked()){pressed=false;clearTimer(timer);activate();}};
 const timer=setTimer(()=>{elapsed=true;resume();},HOLD_MS);
 return {resume,cancel(){pressed=false;clearTimer(timer);}};
}
