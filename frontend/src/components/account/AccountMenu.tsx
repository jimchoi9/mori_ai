import {useEffect,useRef} from 'react';
import {Link,useLocation} from 'react-router';
export function AccountMenu({name,goods,onLogout}:{name:string;goods:boolean;onLogout:()=>void}){
 const ref=useRef<HTMLDetailsElement>(null),location=useLocation();
 const friendly=name.trim()&&name!=='사용자'?name.trim():null;
 useEffect(()=>{if(ref.current)ref.current.open=false;},[location.key]);
 useEffect(()=>{
  const outside=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))ref.current.open=false;};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&ref.current?.open){ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[]);
 return <details ref={ref} className={goods?'goods-account':'app-account'}><summary aria-label="계정 메뉴">{friendly?.slice(0,1)??'나'}</summary><div><p>{friendly?`${friendly}님`:'내 계정'}</p><nav aria-label="내 프로필 메뉴"><Link to="/goods" onClick={event=>{if(location.pathname==='/goods')event.preventDefault();if(ref.current)ref.current.open=false;}}>홈</Link><Link to="/designs">내 디자인</Link><Link to="/albums">내 책장</Link></nav><button className="text" onClick={onLogout}>로그아웃</button></div></details>;
}
