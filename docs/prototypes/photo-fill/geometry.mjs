/** crop caps total loss for ratios >=4:3; near-square photos transition smoothly from cover. */
export function fillPlan({width,height,boxWidth,boxHeight,mode='proposed',crop=.1}){
 if(![width,height,boxWidth,boxHeight].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(crop)||crop<0||crop>=1)throw Error('Invalid photo geometry');
 const contain=Math.min(boxWidth/width,boxHeight/height),cover=Math.max(boxWidth/width,boxHeight/height),portrait=height>=width;
 const ratio=width/height,t=Math.max(0,Math.min(1,(ratio-1)/(4/3-1))),transition=t*t*(3-2*t);
 const coverLoss=1-contain/cover,limitedLoss=Math.min(coverLoss,crop);
 const proposedLoss=coverLoss+(limitedLoss-coverLoss)*transition;
 const scale=mode==='contain'?contain:mode==='cover'||portrait?cover:contain/(1-proposedLoss);
 const shownWidth=width*scale,shownHeight=height*scale;
 return {portrait,transition,zoom:scale/contain,shownWidth,shownHeight,leftLoss:Math.max(0,1-boxWidth/shownWidth)/2,topLoss:Math.max(0,1-boxHeight/shownHeight)/2,gapX:Math.max(0,boxWidth-shownWidth),gapY:Math.max(0,boxHeight-shownHeight)};
}
