import {AlbumCard} from './AlbumCard';
import {ScreenHeader} from '../../components/layout/ScreenHeader';
import {BottomActionBar} from '../../components/layout/BottomActionBar';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query';
import { api, errorText } from '../../api/client';
import type { Album, MediaAccess, Config } from '../../api/types';
import { albumPath } from '../generation/flow';
import { usePrivateRequest } from '../generation/usePrivateRequest';
import { removeAlbum } from './removeAlbum';
const albumLabels:Record<string,string>={draft:'초안',processing:'생성 중',action_required:'확인 필요',review_ready:'결과 확인',published:'완성'};
function Cover({album,access,renew}:{album:Album;access?:MediaAccess;renew:()=>void}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[access?.url]);
 useEffect(()=>{if(!access)return;const timer=window.setTimeout(renew,Math.max(1000,Date.parse(access.expires_at)-Date.now()-10000));return()=>window.clearTimeout(timer);},[access?.url]);
 return <div className="cover">{access && !failed ? <img src={access.url} alt={`${album.title} 표지`} onError={()=>{setFailed(true);renew();}}/> : <><span aria-hidden="true">▤</span><span>{album.page_count}장의 기억</span></>}</div>;
}
export function Bookshelf({userId}: {userId:string}) {
 const [deletingId,setDeletingId]=useState<string|null>(null);const cache=useQueryClient();
 const request=usePrivateRequest();const [error,setError] = useState('');
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 const albums = useInfiniteQuery({queryKey:['albums',userId],initialPageParam:'',queryFn:({pageParam,signal}) => api<{items:Album[];next_cursor:string|null;media_access:MediaAccess[]}>(`/albums${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,{signal}),getNextPageParam:last => last.next_cursor ?? undefined});
 async function remove(album:Album){
  if(deletingId||!window.confirm(`${album.title} 사진첩과 모든 사진을 삭제할까요?`))return;setDeletingId(album.id);setError('');
  try{await removeAlbum(album.id,request.current.signal);if(!request.current.signal.aborted)await cache.invalidateQueries({queryKey:['albums',userId]});}
  catch(e){if(!request.current.signal.aborted){setError(errorText(e));await albums.refetch();}}finally{if(!request.current.signal.aborted)setDeletingId(null);}
 }
 const items = albums.data?.pages.flatMap(p=>p.items) ?? [];
 return <section className="bookshelf-screen"><ScreenHeader title="내 책장" subtitle="다시 펼쳐보고 싶은 순간들"/>{error && <p role="alert">{error}</p>}{albums.isPending && <p role="status">책장을 불러오고 있어요…</p>}{albums.isError && <div role="alert"><p>{errorText(albums.error)}</p><button onClick={()=>void albums.refetch()}>책장 다시 불러오기</button></div>}{!albums.isPending && !albums.isError && !items.length && <div className="empty"><div className="memory-cards" aria-hidden="true"><span/><span/></div><h2>아직은 비어 있는 책장</h2><p>굿즈를 구매하면 전용 사진첩이 생겨요. 좋아하는 사진으로 채워 보세요.</p></div>}<div className="books">{items.map(album=><AlbumCard key={album.id} title={album.title} meta={`${new Date(album.updated_at).toLocaleDateString('ko-KR')} · 사진 ${album.page_count}장`} destination={config.data?.album_content_enabled&&album.page_count>0&&!['processing','action_required'].includes(album.status)?`/albums/${album.id}/manage`:albumPath(album)} cover={<Cover album={album} access={albums.data?.pages.flatMap(p=>p.media_access).find(a=>a.asset_id===album.cover?.asset_id)} renew={()=>void albums.refetch()}/>} status={album.status==='published'?undefined:albumLabels[album.status]??album.status} menu={<details className="book-options"><summary aria-label={`${album.title} 사진첩 더보기`}>···</summary><button className="text danger" disabled={!!deletingId} aria-label={`${album.title} 사진첩 삭제`} onClick={()=>void remove(album)}>{deletingId===album.id?'삭제 중…':'사진첩 삭제'}</button></details>}/>)}</div>{albums.hasNextPage && <button className="secondary" disabled={albums.isFetchingNextPage} onClick={()=>void albums.fetchNextPage()}>사진첩 더 보기</button>}<BottomActionBar><Link className="button-link" to="/goods">굿즈 만들기</Link></BottomActionBar></section>;
}
