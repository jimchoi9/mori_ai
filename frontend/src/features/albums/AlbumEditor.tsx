import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '../../api/client';
import type { Detail, MediaAccess, Page } from '../../api/types';
import { UploadPanel } from '../uploads/UploadPanel';
const labels: Record<string,string>={reserved:'전송 대기',validating:'사진 검증·정규화 중',ready:'준비 완료',rejected:'검증 실패 · 삭제 후 다시 첨부',expired:'업로드 만료 · 삭제 후 다시 첨부'};
function Photo({page,access,renew}:{page:Page;access?:MediaAccess;renew:()=>void}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[access?.url]);
 return <div className="photo">{page.upload_status==='ready' && access && !failed ? <img src={access.url} alt={`${page.position}번째 사진`} onError={()=>{setFailed(true);renew();}}/> : <div className="placeholder"><span aria-hidden="true">▧</span><span>{labels[page.upload_status]}</span>{failed && <button className="secondary" onClick={renew}>미리보기 다시 불러오기</button>}</div>}</div>;
}
export function AlbumEditor({userId}:{userId:string}) {
 const {albumId=''}=useParams(); const navigate=useNavigate(); const cache=useQueryClient();
 const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const [visible,setVisible]=useState(!document.hidden);
 const queryKey=['album',userId,albumId];
 const detail=useQuery({queryKey,queryFn:({signal})=>api<Detail>(`/albums/${albumId}`,{signal}),refetchInterval:q=>visible && q.state.data?.detail.pages.some(p=>['reserved','validating'].includes(p.upload_status)) ? 1800 : false,refetchIntervalInBackground:false});
 const data=detail.data;
 useEffect(()=>{const changed=()=>{setVisible(!document.hidden);if(!document.hidden)void detail.refetch();};document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[albumId]);
 async function renew() {
  if(!data)return; const ids=data.detail.pages.filter(p=>p.upload_status==='ready').map(p=>(p.thumbnail ?? p.source)?.asset_id).filter((id):id is string=>!!id);
  if(!ids.length)return;
  try {const result=await api<{media_access:MediaAccess[]}>(`/albums/${albumId}/media-access`,{method:'POST',body:{asset_ids:ids}});cache.setQueryData<Detail>(queryKey,old=>old?{...old,media_access:result.media_access}:old);}catch(e){setError(errorText(e));}
 }
 useEffect(()=>{
  if(!visible || !data?.media_access.length)return;
  const expires=Math.min(...data.media_access.map(a=>Date.parse(a.expires_at)));
  const timer=window.setTimeout(()=>void renew(),Math.max(1000,expires-Date.now()-10000));return()=>window.clearTimeout(timer);
 },[data,visible]);
 async function mutate(fn:(fresh:Detail)=>Promise<unknown>) {if(busy)return;setBusy(true);setError('');try{const fresh=await api<Detail>(`/albums/${albumId}`);await fn(fresh);await detail.refetch();await cache.invalidateQueries({queryKey:['albums',userId]});}catch(e){setError(errorText(e));await detail.refetch();}finally{setBusy(false);}}
 if(detail.isPending)return <p role="status">사진첩을 불러오는 중…</p>;
 if(!data)return <section><Link to="/albums">← 책장</Link><p role="alert">{errorText(detail.error)}</p><button onClick={()=>void detail.refetch()}>다시 불러오기</button></section>;
 const {album,pages,order_mode}=data.detail;
 async function move(id:string,offset:number) {await mutate(async fresh=>{const ids=fresh.detail.pages.map(p=>p.id);const index=ids.indexOf(id);const next=index+offset;if(index<0 || next<0 || next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];await api(`/albums/${albumId}/page-order`,{method:'PUT',body:{page_ids:ids,expected_version:fresh.detail.album.version}});});}
 return <section><Link className="back" to="/albums">← 나의 책장</Link><div className="section-heading"><div><span className="eyebrow">PHOTO ALBUM · 초안</span><h1>{album.title}</h1><p>{pages.length}장 · {order_mode==='manual'?'직접 정한 순서':'촬영 날짜 순서'}</p></div><button className="danger secondary" disabled={busy} onClick={()=>{if(window.confirm('사진첩과 모든 사진을 삭제할까요?'))void mutate(async fresh=>{await api(`/albums/${albumId}?expected_version=${fresh.detail.album.version}`,{method:'DELETE'});navigate('/albums');});}}>사진첩 삭제</button></div>{error && <p role="alert">{error} 선택한 로컬 파일은 유지됩니다.</p>}<UploadPanel key={albumId} albumId={albumId} userId={userId} refresh={()=>detail.refetch()}/><div className="section-heading"><h2>담은 사진</h2><button disabled aria-label="AI 생성은 준비 중">AI 생성은 준비 중</button></div>{pages.some(p=>p.upload_status==='reserved'||p.upload_status==='validating') && <p className="notice" role="status">검증 중에는 순서가 임시로 표시됩니다. 직접 이동한 순서는 유지됩니다.</p>}{pages.length===0 && <div className="empty"><h2>아직 담은 사진이 없어요</h2><p>위에서 사진을 선택해 주세요.</p></div>}<ol className="pages">{pages.map((page,index)=><li key={page.id} className="page"><Photo page={page} access={data.media_access.find(a=>a.asset_id===(page.thumbnail ?? page.source)?.asset_id)} renew={()=>void renew()}/><div className="page-meta"><strong>{index+1}번째 사진</strong><span role="status">{labels[page.upload_status]}</span><div className="page-actions"><button className="secondary" disabled={busy||index===0} aria-label={`${index+1}번째 사진 앞으로 이동`} onClick={()=>void move(page.id,-1)}>앞으로</button><button className="secondary" disabled={busy||index===pages.length-1} aria-label={`${index+1}번째 사진 뒤로 이동`} onClick={()=>void move(page.id,1)}>뒤로</button><button className="text danger" disabled={busy} aria-label={`${index+1}번째 사진 삭제`} onClick={()=>{if(window.confirm('이 사진을 삭제할까요? 실패한 사진은 삭제한 뒤 다시 첨부할 수 있습니다.'))void mutate(fresh=>api(`/albums/${albumId}/pages/${page.id}?expected_version=${fresh.detail.album.version}`,{method:'DELETE'}));}}>삭제</button></div></div></li>)}</ol></section>;
}
