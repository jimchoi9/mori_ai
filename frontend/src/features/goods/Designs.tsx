import {Link,useParams} from 'react-router';
import {useInfiniteQuery,useQuery} from '@tanstack/react-query';
import {api,errorText} from '../../api/client';
import type {GoodsDesign} from './api';
import {GoodsMockup} from './mockup/GoodsMockup';
import {GlassButton} from '../../components/ui/GlassButton';
import {ScreenHeader} from '../../components/layout/ScreenHeader';
import {PhotoFrame} from '../../components/media/PhotoFrame';
import {TestCheckout} from './TestCheckout';
import './goods.css';
export function Designs({userId}:{userId:string}){
 const query=useInfiniteQuery({queryKey:['goods-designs',userId],initialPageParam:0,queryFn:({pageParam,signal})=>api<{items:GoodsDesign[];next_offset:number|null}>(`/goods/designs?offset=${pageParam}`,{signal}),getNextPageParam:last=>last.next_offset??undefined});
 return <section className="bookshelf-screen"><ScreenHeader title="내 디자인" subtitle="완성한 나만의 굿즈"/>{query.isPending&&<p role="status">불러오고 있어요…</p>}{query.isError&&<p role="alert">{errorText(query.error)} <button onClick={()=>void query.refetch()}>다시 불러오기</button></p>}{query.data?.pages[0].items.length===0&&<p>아직 완성한 디자인이 없어요.</p>}<div className="books">{query.data?.pages.flatMap(p=>p.items).map(d=><Link key={d.id} to={`/designs/${d.id}`}><PhotoFrame ratio="square"><img src={d.image_url} alt="완성한 굿즈 디자인"/></PhotoFrame><p>{d.product==='magnet'?'마그네틱 · ':'키링 · '}{d.fake?'가짜 AI · ':''}{new Date(d.created_at).toLocaleDateString('ko-KR')} · {d.test_purchase?'테스트 사진첩 연결됨':d.album_id?'앨범 연결됨':'디자인 보기'}</p></Link>)}</div>{query.hasNextPage&&<GlassButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>더 보기</GlassButton>}<Link className="button-link" to="/goods">굿즈 만들기</Link></section>;
}
export function DesignDetail({userId}:{userId:string}){
 const {designId}=useParams();
 const detail=useQuery({queryKey:['goods-design',userId,designId],queryFn:({signal})=>api<GoodsDesign>(`/goods/designs/${designId}`,{signal})});
 const d=detail.data;
 return <section className="goods-workspace"><ScreenHeader title="내 디자인" subtitle="완성한 굿즈와 사진첩을 확인하세요."/>{detail.isError&&<p role="alert">{errorText(detail.error)} <button onClick={()=>void detail.refetch()}>다시 불러오기</button></p>}{!d&&!detail.isError&&<p>불러오고 있어요…</p>}{d&&<>{d.fake&&<p className="notice">개발용 가짜 AI 결과입니다.</p>}<GoodsMockup src={d.image_url} product={d.product??'keyring'} placement={d.placement}/><TestCheckout key={d.id} design={d} userId={userId}/>{d.album_id&&<Link to={`/albums/${d.album_id}/view`}>기존 연결 앨범 보기</Link>}</>}<p><Link to="/designs">내 디자인 목록</Link></p></section>;
}
