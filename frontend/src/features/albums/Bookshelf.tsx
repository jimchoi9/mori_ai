import {albumPeriod} from './albumMeta';
import './bookshelf.css';
import {Link,useNavigate} from 'react-router';
import {AlbumCard} from './AlbumCard';
import {ScreenHeader} from '../../components/layout/ScreenHeader';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query';
import { api, errorText } from '../../api/client';
import type { Album, MediaAccess, Config } from '../../api/types';
import { albumPath,requestIntents } from '../generation/flow';
import { usePrivateRequest } from '../generation/usePrivateRequest';
import { removeAlbum } from './removeAlbum';
const albumLabels:Record<string,string>={draft:'초안',processing:'생성 중',action_required:'확인 필요',review_ready:'결과 확인',published:'완성'};
function Cover({album,access,renew}:{album:Album;access?:MediaAccess;renew:()=>void}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[access?.url]);
 useEffect(()=>{if(!access)return;const timer=window.setTimeout(renew,Math.max(1000,Date.parse(access.expires_at)-Date.now()-10000));return()=>window.clearTimeout(timer);},[access?.url]);
 return <div className={`cover${album.page_count===0?' cover-empty':''}`}>{access && !failed ? <img src={access.url} alt={`${album.title} 표지`} onError={()=>{setFailed(true);renew();}}/> : album.page_count===0 ? <><span className="cover-add" aria-hidden="true">＋</span><span className="cover-add-label">사진 추가</span></> : <><span aria-hidden="true">▤</span><span>사진 {album.page_count}장</span></>}</div>;
}
export function Bookshelf({userId}: {userId:string}) {
 const navigate=useNavigate(),creating=useRef(false),[createBusy,setCreateBusy]=useState(false);
 const [deletingId,setDeletingId]=useState<string|null>(null);const cache=useQueryClient();
 const request=usePrivateRequest();const [error,setError] = useState('');
 const config=useQuery({queryKey:['client-config',userId],queryFn:({signal})=>api<Config>('/client-config',{signal})});
 const albums = useInfiniteQuery({queryKey:['albums',userId],initialPageParam:'',queryFn:({pageParam,signal}) => api<{items:Album[];next_cursor:string|null;media_access:MediaAccess[]}>(`/albums${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,{signal}),getNextPageParam:last => last.next_cursor ?? undefined,refetchInterval:q=>!document.hidden&&q.state.data?.pages.some(page=>page.items.some(album=>album.title_pending))?1800:false,refetchIntervalInBackground:false});
 async function create(){
  if(config.data?.album_content_enabled){navigate('/albums/new');return;}
  if(!config.data)return;
  if(creating.current)return;creating.current=true;setCreateBusy(true);setError('');
  const scope=`create-album:${userId}`,intent=requestIntents.get(scope,{});
  try{const data=await api<{album:Album}>('/albums',{method:'POST',body:intent.body,key:intent.key,signal:request.current.signal});
   if(request.current.signal.aborted)return;requestIntents.finish(scope);void cache.invalidateQueries({queryKey:['albums',userId]}).catch(()=>undefined);
   if(!request.current.signal.aborted)navigate(albumPath(data.album));
  }catch(e){if(!request.current.signal.aborted)setError(errorText(e));}
  finally{creating.current=false;if(!request.current.signal.aborted)setCreateBusy(false);}
 }
 async function remove(album:Album){
  if(deletingId||!window.confirm(`${album.title} 사진첩과 모든 사진을 삭제할까요?`))return;setDeletingId(album.id);setError('');
  try{await removeAlbum(album.id,request.current.signal);if(!request.current.signal.aborted)await cache.invalidateQueries({queryKey:['albums',userId]});}
  catch(e){if(!request.current.signal.aborted){setError(errorText(e));await albums.refetch();}}finally{if(!request.current.signal.aborted)setDeletingId(null);}
 }
 const items = albums.data?.pages.flatMap(p=>p.items) ?? [];
 return <section className="bookshelf-screen">
  <ScreenHeader title="내 앨범" trailing={items.length>0||albums.isPending ? <button className="album-create" disabled={!config.data||createBusy||!!deletingId} onClick={()=>void create()}>{createBusy?'만드는 중…':'＋ 새 앨범'}</button> : undefined}/>
  {error && <p role="alert">{error}</p>}
  {config.isError&&<div role="alert"><p>{errorText(config.error)}</p><button onClick={()=>void config.refetch()}>설정 다시 불러오기</button></div>}
  {albums.isPending && <p role="status">앨범을 불러오고 있어요…</p>}
  {albums.isError && <div role="alert"><p>{errorText(albums.error)}</p><button onClick={()=>void albums.refetch()}>앨범 다시 불러오기</button></div>}
  {!albums.isPending && !albums.isError && !items.length && <div className="empty album-empty-state">
   <h2>아직 앨범이 없어요</h2><p>사진을 담으면 추억책으로 볼 수 있어요.</p>
   <button className="album-create" disabled={!config.data||createBusy} onClick={()=>void create()}>첫 앨범 만들기</button>
  </div>}
  <div className="books">{items.map(album=>{
   const management=config.data?.album_content_enabled&&album.page_count>0&&!['processing','action_required'].includes(album.status)?`/albums/${album.id}/manage`:albumPath(album);
   const ready=album.content_ready||album.status==='published',period=albumPeriod(album.capture_period);
   return <AlbumCard key={album.id} title={album.title}
    meta={<>{period&&<span>{period}</span>}<span>사진 {album.page_count}장</span></>}
    destination={management}
    cover={<Cover album={album} access={albums.data?.pages.flatMap(p=>p.media_access).find(a=>a.asset_id===album.cover?.asset_id)} renew={()=>void albums.refetch()}/>}
    status={['processing','action_required'].includes(album.status)?albumLabels[album.status]:undefined}
    menu={<>
     {ready ? <Link className="album-watch" aria-label={`${album.title} 감상하기`} to={`/albums/${album.id}/view`}>감상하기 <span aria-hidden="true">↗</span></Link>
      : <Link className="album-watch" aria-label={`${album.title} ${album.page_count===0?'사진 추가':'사진 관리'}`} to={management}>{album.page_count===0?'사진 추가':'사진 관리'} <span aria-hidden="true">↗</span></Link>}
     <details className="book-options"><summary aria-label={`${album.title} 사진첩 더보기`}>···</summary><button className="text danger" disabled={!!deletingId} aria-label={`${album.title} 사진첩 삭제`} onClick={()=>void remove(album)}>{deletingId===album.id?'삭제 중…':'사진첩 삭제'}</button></details>
    </>}/>;
  })}</div>
  {albums.hasNextPage && <button className="secondary" disabled={albums.isFetchingNextPage} onClick={()=>void albums.fetchNextPage()}>사진첩 더 보기</button>}
  <footer className="albums-goods-link"><Link to="/goods">사진으로 굿즈 만들기 <span aria-hidden="true">↗</span></Link></footer>
 </section>;
}
