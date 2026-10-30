import {useEffect,useRef,useState} from 'react';
import {ApiError,errorText} from '../../api/client';
import {adminUsers,approveUser} from './api';
import type {AdminUser,AdminUsers} from './types';

export function AdminPage({csrfToken,accessMode,onDenied}:{csrfToken:string;accessMode:string;onDenied:(error:ApiError)=>void}){
 const [input,setInput]=useState(''),[q,setQ]=useState(''),[history,setHistory]=useState<(string|null)[]>([null]);
 const [data,setData]=useState<AdminUsers|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const live=useRef(true),mutation=useRef<AbortController|null>(null),locked=useRef(false);
 const denied=useRef(onDenied);denied.current=onDenied;
 const cursor=history[history.length-1];
 useEffect(()=>{live.current=true;return()=>{live.current=false;mutation.current?.abort();};},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setData(null);setError('');
  void adminUsers(q,cursor,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);})
   .catch(e=>{if(!controller.signal.aborted){if(e instanceof ApiError&&(e.status===401||e.status===403))denied.current(e);else setError(errorText(e));}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[q,cursor,refresh]);
 async function change(user:AdminUser){
  if(locked.current)return;
  if(user.approved&&!window.confirm(`${user.display_name}\n계정 ID: ${user.id}\n이 사용자의 이용 승인을 취소할까요?`))return;
  locked.current=true;setBusy(true);setNotice('');const controller=new AbortController();mutation.current=controller;
  try{
   await approveUser(user,!user.approved,csrfToken,controller.signal);
   if(live.current)setNotice(`${user.display_name}: ${user.approved?'승인 취소':'승인'}했습니다.`);
  }catch(e){
   if(!live.current||controller.signal.aborted)return;
   if(e instanceof ApiError&&(e.status===401||e.code==='ADMIN_REQUIRED')){denied.current(e);return;}
   setNotice(e instanceof ApiError&&e.status===409?'다른 변경이 있습니다. 최신 상태를 확인한 뒤 다시 선택해 주세요.':`변경 결과를 확인해야 합니다. 자동 재전송하지 않고 목록을 다시 조회합니다. ${errorText(e)}`);
  }finally{
   locked.current=false;
   if(live.current){setBusy(false);setRefresh(n=>n+1);}
  }
 }
 return <section>
  {accessMode==='all_authenticated'&&<p className="notice">현재 공개 모드입니다. 승인 취소를 해도 서비스 이용은 차단되지 않습니다.</p>}
  <form className="admin-search" onSubmit={e=>{e.preventDefault();setQ(input.trim());setHistory([null]);setRefresh(n=>n+1);setNotice('');}}>
   <label htmlFor="admin-search">이름 또는 계정 UUID</label><input id="admin-search" maxLength={100} value={input} onChange={e=>setInput(e.target.value)} disabled={busy}/><button disabled={busy}>검색</button>
  </form>
  {notice&&<p role="status">{notice}</p>}{error&&<div><p role="alert">{error}</p><button onClick={()=>setRefresh(n=>n+1)}>목록 다시 시도</button></div>}
  {loading&&<p role="status">사용자 목록을 불러오고 있어요…</p>}
  {data&&<><ul className="admin-users">{data.items.map(user=><li key={user.id}>
   <div><strong>{user.display_name}</strong><p>계정 ID: <code>{user.id}</code></p><p>로그인: {user.providers.join(', ')||'로컬 계정'} · 가입: {new Date(user.created_at).toLocaleDateString('ko-KR')}</p><p>{user.approved?'승인됨':'승인 대기'}{user.is_admin?' · 관리자 (승인 취소 전 CLI에서 관리자 해제 필요)':''}</p></div>
   <button disabled={busy||user.is_admin} onClick={()=>void change(user)} aria-label={`${user.display_name} (${user.id}) ${user.approved?'승인 취소':'승인'}`}>{user.approved?'승인 취소':'승인'}</button>
  </li>)}</ul>{!data.items.length&&<p>검색 결과가 없습니다.</p>}</>}
  <nav className="admin-pages" aria-label="사용자 목록 페이지"><button disabled={busy||loading||history.length===1} onClick={()=>setHistory(v=>v.slice(0,-1))}>이전</button><span>{history.length}페이지</span><button disabled={busy||loading||!data?.next_cursor} onClick={()=>{if(data?.next_cursor)setHistory(v=>[...v,data.next_cursor]);}}>다음</button></nav>
 </section>;
}
