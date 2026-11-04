export const HOLD_MS=300;
export function createHold(blocked:()=>boolean,activate:()=>void){
 let pressed=true,elapsed=false;
 const resume=()=>{if(pressed&&elapsed&&!blocked()){pressed=false;clearTimeout(timer);activate();}};
 const timer=setTimeout(()=>{elapsed=true;resume();},HOLD_MS);
 return {resume,cancel(){pressed=false;clearTimeout(timer);}};
}
