import {useEffect,useRef} from 'react';
export function LoadingScene({previews}:{previews:string[]}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const surface=canvas.current,ctx=surface?.getContext('2d');if(!surface||!ctx)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame=0,width=0,height=0,last=0;
  const points=Array.from({length:200},()=>({x:(Math.random()-.5)*2100,y:(Math.random()-.5)*2300,z:30+Math.random()*2200,r:.7+Math.random()*1.6}));
  const resize=()=>{width=innerWidth;height=innerHeight;const dpr=Math.min(devicePixelRatio||1,1.5);surface.width=width*dpr;surface.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);};
  const draw=(time:number)=>{if(document.hidden)return;const delta=Math.min(40,time-(last||time));last=time;ctx.clearRect(0,0,width,height);const cx=width*.5+Math.sin(time/11000)*width*.025,cy=height*.44+Math.cos(time/14000)*height*.012,focal=Math.min(width,height)*.9;for(const p of points){if(!reduced)p.z-=delta*.15;if(p.z<30)p.z=2200;const s=focal/p.z,x=cx+p.x*s,y=cy+p.y*s,r=Math.min(5,p.r*s*1.6),alpha=Math.min(.8,.3+s*.35)*(1-p.z/2700);ctx.fillStyle=`rgba(255,238,200,${alpha})`;ctx.beginPath();ctx.arc(x,y,Math.max(.35,r),0,Math.PI*2);ctx.fill();}if(!reduced)frame=requestAnimationFrame(draw);};
  const visibility=()=>{cancelAnimationFrame(frame);last=0;if(!document.hidden)frame=requestAnimationFrame(draw);};
  resize();frame=requestAnimationFrame(draw);addEventListener('resize',resize);document.addEventListener('visibilitychange',visibility);
  return()=>{cancelAnimationFrame(frame);removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 return <section className="nfc-loading" aria-label="추억 속으로 들어가는 중"><canvas ref={canvas} aria-hidden="true"/><div className="nfc-memories" aria-hidden="true">{previews.map((src,i)=><img key={i} src={src} alt=""/>)}</div><div className="nfc-intro"><small>THE MOMENTS WE KEEP</small><h1>그날의 온기로.</h1><p>함께한 시간 속으로 들어갑니다</p></div></section>;
}
