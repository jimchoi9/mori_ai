/** Display-only policy; dimensions are read after browser orientation handling. */
export function photoLayout(width:number,height:number,boxWidth:number,boxHeight:number){
 if(![width,height,boxWidth,boxHeight].every(v=>Number.isFinite(v)&&v>0))return null;
 const contain=Math.min(boxWidth/width,boxHeight/height),cover=Math.max(boxWidth/width,boxHeight/height);
 const t=Math.max(0,Math.min(1,(width/height-1)/(4/3-1))),blend=t*t*(3-2*t);
 const coverLoss=1-contain/cover,loss=coverLoss+(Math.min(coverLoss,.1)-coverLoss)*blend;
 return {portrait:height>=width,zoom:1/(1-loss)};
}
