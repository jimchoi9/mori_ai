import {useState} from 'react';
import {Link} from 'react-router';
import {GlassButton} from '../../components/ui/GlassButton';
import {PhotoOwnerChoice} from './purchase/PhotoOwnerChoice';
import {useCheckoutConfig,useGoodsCheckout} from './purchase/useGoodsCheckout';
import type {GoodsDesign} from './api';
export {useCheckoutConfig} from './purchase/useGoodsCheckout';

/** Existing saved-design entry uses the same checkout lifetime as the creation flow. */
export function TestCheckout({design,userId}:{design:GoodsDesign;userId:string}){
 const config=useCheckoutConfig(),checkout=useGoodsCheckout(userId),[gift,setGift]=useState(false);
 const purchase=checkout.completed??design.test_purchase;
 if(purchase)return <section className="test-checkout" aria-label="테스트 구매">
  <p className="notice">전용 사진첩이 연결되었어요. 실제 결제·제작·배송은 진행되지 않습니다.</p>
  <p>{purchase.album_status==='deleted'?'연결된 사진첩이 삭제되었습니다.':'구매한 굿즈의 사진첩을 이어서 채워 보세요.'}</p>
  <Link className="button-link" to={`/purchases/${purchase.id}`}>{purchase.album_status==='deleted'?'주문 내역 보기':'내 사진첩으로'}</Link>
 </section>;
 if(config.isPending)return <p role="status">구매 체험을 준비하고 있어요…</p>;
 if(config.isError)return <p role="alert">구매 체험 설정을 불러오지 못했어요. <button onClick={()=>void config.refetch()}>다시 확인</button></p>;
 if(config.data?.goods_checkout_mode!=='test'||design.album_id||design.production_started)return null;
 return <section className="test-checkout" aria-label="테스트 결제">
  <h2>굿즈에 담을 사진을 추가해 보세요</h2>
  <PhotoOwnerChoice gift={gift} onChange={setGift} disabled={checkout.busy||checkout.attempted} name={`photo-owner-${design.id}`}/>
  <GlassButton disabled={checkout.busy} onClick={()=>void checkout.checkout(design,gift)}>{checkout.busy?'사진첩 준비 중…':checkout.error?'같은 구매 다시 시도':gift?'테스트 구매하고 선물 준비하기':'테스트 구매하고 사진 채우기'}</GlassButton>
  <p className="hint">실제 요금 청구나 제작·배송 요청은 발생하지 않습니다.</p>
  {checkout.error&&<p className="goods-error" role="alert">{checkout.error}</p>}
 </section>;
}
