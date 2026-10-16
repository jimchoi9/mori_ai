import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, errorText } from '../../api/client';
import type { Album, MediaAccess } from '../../api/types';
const createKeys = new Map<string,string>();
window.addEventListener('mori:logout',()=>createKeys.clear());
function Cover({album,access,renew}:{album:Album;access?:MediaAccess;renew:()=>void}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[access?.url]);
 useEffect(()=>{if(!access)return;const timer=window.setTimeout(renew,Math.max(1000,Date.parse(access.expires_at)-Date.now()-10000));return()=>window.clearTimeout(timer);},[access?.url]);
 return <div className="cover">{access && !failed ? <img src={access.url} alt={`${album.title} 표지`} onError={()=>{setFailed(true);renew();}}/> : <><span aria-hidden="true">▤</span><span>{album.page_count}장의 기억</span></>}</div>;
}
export function Bookshelf({userId}: {userId:string}) {
 const navigate = useNavigate(); const key = useRef<string|null>(createKeys.get(userId) ?? null); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
 const albums = useInfiniteQuery({queryKey:['albums',userId],initialPageParam:'',queryFn:({pageParam,signal}) => api<{items:Album[];next_cursor:string|null;media_access:MediaAccess[]}>(`/albums${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,{signal}),getNextPageParam:last => last.next_cursor ?? undefined});
 async function create() { if(busy)return; setBusy(true); setError(''); key.current ??= crypto.randomUUID(); createKeys.set(userId,key.current); try {const result = await api<{album:Album}>('/albums',{method:'POST',body:{},key:key.current}); key.current=null; createKeys.delete(userId); navigate(`/albums/${result.album.id}/edit`);}catch(e){setError(errorText(e));}finally{setBusy(false);} }
 const items = albums.data?.pages.flatMap(p=>p.items) ?? [];
 return <section><div className="section-heading"><div><span className="eyebrow">MY BOOKSHELF</span><h1>나의 책장</h1><p>소중한 순간을 모아 두는 작은 공간.</p></div><button disabled={busy} onClick={() => void create()}>{busy?'사진첩 준비 중…':key.current?'사진첩 생성 다시 시도':'+ 새 사진첩'}</button></div>{error && <p role="alert">{error} 같은 생성 요청으로 다시 시도합니다.</p>}{albums.isPending && <p role="status">책장을 불러오고 있어요…</p>}{albums.isError && <div role="alert"><p>{errorText(albums.error)}</p><button onClick={()=>void albums.refetch()}>책장 다시 불러오기</button></div>}{!albums.isPending && !albums.isError && !items.length && <div className="empty"><span className="book-symbol" aria-hidden="true">▤</span><h2>첫 사진첩을 기다리고 있어요</h2><p>새 사진첩을 만들고 좋아하는 사진을 담아 보세요.</p></div>}<div className="books">{items.map(album=><Link className="book" key={album.id} to={`/albums/${album.id}/edit`}><Cover album={album} access={albums.data?.pages.flatMap(p=>p.media_access).find(a=>a.asset_id===album.cover?.asset_id)} renew={()=>void albums.refetch()}/><h2>{album.title}</h2><p>{album.status==='draft'?'초안':album.status} · {new Date(album.updated_at).toLocaleDateString('ko-KR')}</p></Link>)}</div>{albums.hasNextPage && <button className="secondary" disabled={albums.isFetchingNextPage} onClick={()=>void albums.fetchNextPage()}>사진첩 더 보기</button>}</section>;
}
